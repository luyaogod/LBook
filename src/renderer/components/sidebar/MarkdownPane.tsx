import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { readField, writeField } from "@/api/pdfs";
import { recordEdit } from "@/lib/editHistory";
import { useEditHistory } from "@/hooks/useEditHistory";
import { writeErrorText } from "@/lib/writeError";
import { SourceEditorField } from "./SourceEditorField";

/**
 * This page's Markdown, and the way to correct it.
 *
 * It is the same trade as an OCR block's card (see `BlockCard.tsx`), one level up: the
 * editor holds the string `markdown.text` actually contains — the Markdown source, not
 * what it renders to — and one save replaces that one field's bytes in `ocr.json`.
 *
 * **Two readings of one page.** The Blocks view reads `parsing_res_list`; this view reads
 * `markdown.text`. Correcting one does not rewrite the other (A10, A18), so this pane
 * never offers to "sync" them: that would mean reproducing PaddleOCR's own layout rules,
 * and guessing wrong is worse than two honest versions.
 *
 * **No chrome of its own.** The buttons that open, cancel, save or undo an edit are
 * rendered into the panel's footer (`actionsSlot`), so the reading view is nothing but the
 * page's own text and the editing view is nothing but the editor. The editor fills the
 * space between, and scrolls itself — the panel around it never scrolls while editing
 * (`onEditingChange`), or the reader would be dragging two scrollbars to reach one document.
 *
 * What it does *not* say any more: "Editing this page". The editor is on screen and the
 * Save button is two inches away; a caption explaining that is furniture.
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
  /** Where the buttons go — the panel's footer. Until it exists, they are not drawn. */
  actionsSlot?: HTMLElement | null;
  /** Lets the panel drop its padding and its scrolling while the editor owns the area. */
  onEditingChange?: (editing: boolean) => void;
}

export function MarkdownPane({
  uid,
  pageIndex,
  value,
  children,
  editable,
  actionsSlot = null,
  onEditingChange,
}: MarkdownPaneProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [baseValue, setBaseValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entries, undo: undoEntry } = useEditHistory(uid);
  /** This pane's entry on the session's history, while it is still there. */
  const [entryId, setEntryId] = useState<number | null>(null);
  const myEntry = entryId === null ? undefined : entries.find((entry) => entry.id === entryId);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

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
        setError(writeErrorText(t, outcome));
        return;
      }
      const entry = recordEdit({ uid, pageIndex, field: "markdown", before: baseValue, after: text });
      setEntryId(entry.id);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [uid, pageIndex, text, baseValue, t]);

  const undo = useCallback(async () => {
    if (myEntry === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await undoEntry(myEntry);
      if (!outcome.ok) setError(writeErrorText(t, { error: outcome.error ?? "", code: outcome.code }));
    } finally {
      setSaving(false);
    }
  }, [myEntry, undoEntry, t]);

  const cancel = useCallback(() => setEditing(false), []);

  /** The panel's footer buttons for whichever mode this pane is in. */
  const actions =
    actionsSlot === null
      ? null
      : createPortal(
          editing ? (
            <>
              <button
                className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={cancel}
                disabled={saving}
                title={t("block.escapeHint")}
              >
                {t("common.cancel")}
              </button>
              <button
                className="rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void save()}
                disabled={saving || text === baseValue}
                title={t("block.saveKeysHint")}
              >
                {t("common.save")}
              </button>
            </>
          ) : (
            <>
              {myEntry !== undefined && (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  {t("block.saved")}
                </span>
              )}
              {myEntry !== undefined && (
                <button
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => void undo()}
                  disabled={saving}
                  title={t("block.undo")}
                >
                  <Undo2 className="h-3 w-3" />
                  {t("block.undo")}
                </button>
              )}
              {editable && (
                <button
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => void startEditing()}
                  title={t("markdown.edit")}
                >
                  <Pencil className="h-3 w-3" />
                  {t("markdown.edit")}
                </button>
              )}
            </>
          ),
          actionsSlot,
        );

  if (editing) {
    return (
      // The editor is the whole area: no padding to look at, no border to look at, and it
      // scrolls inside itself. The error, when there is one, is a line above it — rare
      // enough not to deserve space, important enough to be seen without hunting.
      <div className="flex h-full min-h-0 flex-col">
        {error !== null && <p className="shrink-0 px-3 py-1 text-xs text-destructive">{error}</p>}
        <SourceEditorField
          className="min-h-0 flex-1"
          value={baseValue}
          language="markdown"
          onValueChange={setText}
          onSave={() => void save()}
          onCancel={cancel}
        />
        {actions}
      </div>
    );
  }

  return (
    <>
      {children}
      {actions}
    </>
  );
}
