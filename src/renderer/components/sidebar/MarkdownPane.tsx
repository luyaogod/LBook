import { useCallback, useState, type ReactNode } from "react";
import { Check, Pencil, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readField, writeField } from "@/api/pdfs";

/**
 * This page's Markdown, and the way to correct it.
 *
 * It is the same trade as an OCR block's card (see `BlockCard.tsx`), one level up: the
 * editor holds the string `markdown.text` actually contains — the Markdown source, not
 * what it renders to — and one save replaces that one field's bytes in `ocr.json`.
 *
 * **Two readings of one page.** The Blocks view reads `parsing_res_list`; this view reads
 * `markdown.text`. Correcting one does not rewrite the other (A10, A18), so the editor
 * says which copy is open and offers no way to "sync" them: that would mean reproducing
 * PaddleOCR's own layout rules, and guessing wrong is worse than two honest versions.
 *
 * The chrome lives here and the reading view is the parent's `children`, so the plugins
 * that render OCR Markdown stay in one place and this component only knows how to edit
 * a string.
 */
interface MarkdownPaneProps {
  /** Book uid, needed to write. */
  uid?: string;
  /** This page, 0-based — the file's own numbering (A8). */
  pageIndex: number;
  /** What the file holds now; the editor's starting point and its concurrency base. */
  value: string;
  /** How the Markdown reads normally. Shown whenever the editor is closed. */
  children: ReactNode;
  /**
   * Editing is offered only in page-flip mode: a page is the unit the file is written in
   * (see `.agents/plan/04-phase4-content-edit.md`).
   */
  editable: boolean;
}

export function MarkdownPane({ uid, pageIndex, value, children, editable }: MarkdownPaneProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [baseValue, setBaseValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the last save replaced, so it can be put back in one write. */
  const [written, setWritten] = useState<{ before: string; after: string } | null>(null);

  const startEditing = useCallback(async () => {
    if (uid === undefined) return;
    // Read it from the file rather than trusting what is on screen: this is the string a
    // save would replace, and comparing against it is what makes a stale save fail
    // instead of overwriting someone else's change.
    const outcome = await readField(uid, pageIndex, "markdown");
    const current = outcome.ok ? (outcome.value.value ?? "") : value;
    setText(current);
    setBaseValue(current);
    setError(outcome.ok ? null : t("message.edit.noMarkdown"));
    setEditing(true);
  }, [uid, pageIndex, value, t]);

  const save = useCallback(async () => {
    if (uid === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await writeField({ uid, pageIndex, field: "markdown", value: text, baseValue });
      if (!outcome.ok) {
        // Our own words come back as a key; anything else is shown as it came.
        setError(outcome.code ? t(outcome.code as never, { defaultValue: outcome.error }) : outcome.error);
        return;
      }
      setWritten({ before: baseValue, after: text });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [uid, pageIndex, text, baseValue, t]);

  const undo = useCallback(async () => {
    if (written === null || uid === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await writeField({
        uid,
        pageIndex,
        field: "markdown",
        value: written.before,
        baseValue: written.after,
      });
      if (!outcome.ok) {
        setError(outcome.code ? t(outcome.code as never, { defaultValue: outcome.error }) : outcome.error);
        return;
      }
      setWritten(null);
    } finally {
      setSaving(false);
    }
  }, [written, uid, pageIndex, t]);

  if (editing) {
    return (
      <div>
        <div className="mb-1 flex items-center gap-2">
          {/* A18: the editor names its target. The other view is not being changed. */}
          <span className="text-xs font-medium">{t("markdown.editing")}</span>
          <span className="text-[11px] text-muted-foreground">{t("markdown.sourceHint")}</span>
        </div>

        <textarea
          className="w-full resize-y rounded border border-primary bg-background p-2 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
          // The reading size, so the text does not change size when the editor opens —
          // monospaced, because what is being edited is markup.
          style={{ fontSize: "var(--reading-font-size, 14px)" }}
          rows={Math.min(40, Math.max(6, text.split("\n").length + 1))}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              // The file has not been touched: the editor holds a copy, and only a save
              // writes. Esc therefore costs nothing.
              setEditing(false);
            }
          }}
          autoFocus
        />

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t("block.saveHint")}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </button>
            <button
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              onClick={() => void save()}
              disabled={saving || text === baseValue}
            >
              {t("common.save")}
            </button>
          </div>
        </div>

        {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {editable && (
        <div className="mb-2 flex items-center gap-2">
          {written !== null && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              {t("block.saved")}
            </span>
          )}
          {written !== null && (
            <button
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void undo()}
              disabled={saving}
              title={t("block.undo")}
            >
              <Undo2 className="h-3 w-3" />
              {t("block.undo")}
            </button>
          )}
          <button
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => void startEditing()}
            title={t("markdown.edit")}
          >
            <Pencil className="h-3 w-3" />
            {t("markdown.edit")}
          </button>
        </div>
      )}

      {error !== null && !editing && <p className="mb-2 text-xs text-destructive">{error}</p>}

      {children}
    </div>
  );
}
