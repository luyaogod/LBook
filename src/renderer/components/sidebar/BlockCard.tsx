import { useCallback, useRef, useState } from "react";
import type { OcrBlock } from "@/types";
import { BLOCK_LABEL_COLORS } from "@/components/viewer/blockColors";
import { Image, Table2, FileText, Pencil, Undo2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { resolveAssetUrls } from "@shared/urls";
import { useTranslation } from "react-i18next";
import { readField, writeField } from "@/api/pdfs";
import { recordEdit } from "@/lib/editHistory";
import { useEditHistory } from "@/hooks/useEditHistory";
import { writeErrorText } from "@/lib/writeError";
import { SourceEditorField } from "./SourceEditorField";


/**
 * One OCR block, as plain output — and, in page-flip mode, as an editable field.
 *
 * **What editing means here.** The text in the editor is the *source*: whatever string
 * `parsing_res_list[i].block_content` holds, character for character. A Markdown
 * paragraph looks like Markdown, a table looks like HTML, and neither is rendered
 * while being edited. That is the point rather than a shortcoming: what is being
 * corrected is the file's content, and a what-you-see view would turn "change the
 * text" into "change the rendering".
 *
 * **What cannot be touched.** Only that one field is written. Coordinates, labels and
 * the structure of the page are not reachable from here (see
 * `.agents/plan/04-phase4-content-edit.md`): the app trusts the coordinates PaddleOCR
 * produced and only corrects what it read.
 *
 * **Two readings, one page.** Correcting a block does *not* rewrite the page's
 * Markdown, and correcting the Markdown does not rewrite the blocks (A18). They are
 * independent readings of the same file, so the panel says which one is being edited
 * and never pretends they are in step.
 */
interface BlockCardProps {
  block: OcrBlock;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
  onClick: (id: number) => void;
  /** Book uid, used to point relative image references at the book folder. */
  bookUid?: string;
  /**
   * This block's page, 0-based — the file's own numbering (A8). Absent when the card
   * is shown somewhere editing is not offered (flow mode), which is also what turns
   * the pencil off.
   */
  pageIndex?: number;
}

function isImageBlock(block: OcrBlock): boolean {
  return ["image", "header_image", "footer_image"].includes(block.block_label);
}

function isTableBlock(block: OcrBlock): boolean {
  return block.block_label === "table";
}

function formatLabel(label: string): string {
  return label.replace(/_/g, " ");
}

function handleClick(onClick: (id: number) => void, blockIndex: number) {
  const sel = window.getSelection();
  if (sel && sel.toString().length > 0) return; // user is selecting text, skip
  onClick(blockIndex);
}

export function BlockCard({
  block,
  isHighlighted,
  onHover,
  onClick,
  bookUid,
  pageIndex,
}: BlockCardProps) {
  const { t } = useTranslation();
  // PaddleOCR emits `imgs/x.jpg`, which would otherwise resolve against the app
  // origin and 404. Rewriting to lbook://asset/<uid>/... reads it out of the book
  // folder. Absolute URLs are left alone so the CSP keeps blocking them.
  const content =
    bookUid && block.block_content
      ? resolveAssetUrls(block.block_content, bookUid)
      : block.block_content;
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);

  const editable = pageIndex !== undefined;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [baseValue, setBaseValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entries, undo: undoEntry } = useEditHistory(bookUid);
  /**
   * The entry this card put on the session's history, if it is still there.
   *
   * Not "the last edit", which is what an undo button usually means: the reader may have
   * corrected something else since, or pressed Ctrl+Z, and this button must not undo a
   * different field. When the entry is gone the button goes with it.
   */
  const [entryId, setEntryId] = useState<number | null>(null);
  const myEntry = entryId === null ? undefined : entries.find((entry) => entry.id === entryId);

  const startEditing = useCallback(
    async (event?: React.MouseEvent) => {
      event?.stopPropagation();
      if (pageIndex === undefined) return;

      // Read the field from the file rather than trusting the rendered content: they
      // are the same string today, and reading is what makes the editor show what a
      // save would actually replace.
      if (bookUid === undefined) return;
      const outcome = await readField(bookUid, pageIndex, "block_content", block.block_index);
      const value = outcome.ok ? (outcome.value.value ?? "") : (block.block_content ?? "");
      setText(value);
      setBaseValue(value);
      setError(outcome.ok ? null : t("message.edit.noBlock"));
      setEditing(true);
    },
    [pageIndex, bookUid, block.block_index, block.block_content, t],
  );

  const save = useCallback(async () => {
    if (pageIndex === undefined || bookUid === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await writeField({
        uid: bookUid,
        pageIndex,
        field: "block_content",
        blockIndex: block.block_index,
        value: text,
        baseValue,
      });
      if (!outcome.ok) {
        setError(writeErrorText(t, outcome));
        return;
      }
      // Only the difference is remembered: the two strings, not a page's bytes.
      const entry = recordEdit({
        uid: bookUid,
        pageIndex,
        field: "block_content",
        blockIndex: block.block_index,
        before: baseValue,
        after: text,
      });
      setEntryId(entry.id);
      setEditing(false);
      // The page re-reads on its own: main announces the write and the data hooks
      // follow that event, so there is one refresh path rather than two.
    } finally {
      setSaving(false);
    }
  }, [pageIndex, bookUid, block.block_index, text, baseValue, t]);

  const undo = useCallback(async () => {
    if (myEntry === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await undoEntry(myEntry);
      // A refusal leaves the entry in place: the file has moved on, so there is nothing
      // to put back, and keeping it means the reader can see what happened.
      if (!outcome.ok) setError(writeErrorText(t, { error: outcome.error ?? "", code: outcome.code }));
    } finally {
      setSaving(false);
    }
  }, [myEntry, undoEntry, t]);

  if (editing) {
    return (
      <div
        ref={cardRef}
        data-block-id={block.block_index}
        className="rounded-md border border-primary p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <BlockLabel label={block.block_label} colors={colors} />
        </div>

        {/* A CodeMirror field, on the source as it is in the file: Markdown for a text
            block, HTML for a table (the table's content *is* HTML). Capped rather than
            filling: a card lives in a scrolling column, and one card must not swallow it.
            Keys on the buttons, no line of explanation (they were being ignored anyway). */}
        <SourceEditorField
          className="max-h-96 rounded border border-primary"
          value={baseValue}
          language={isTableBlock(block) ? "html" : "markdown"}
          onValueChange={setText}
          onSave={() => void save()}
          onCancel={() => setEditing(false)}
        />

        <div className="mt-2 flex items-center justify-end gap-1">
          <button
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => setEditing(false)}
            disabled={saving}
            title={t("block.escapeHint")}
          >
            {t("common.cancel")}
          </button>
          <button
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void save()}
            disabled={saving || text === baseValue}
            title={t("block.saveKeysHint")}
          >
            {t("common.save")}
          </button>
        </div>

        {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      data-block-id={block.block_index}
      className={`relative rounded-md border p-3 transition-colors cursor-pointer group ${
        isHighlighted ? "ring-2 ring-primary/50 bg-accent/30" : "hover:bg-accent/20"
      }`}
      style={{ borderColor: isHighlighted ? colors.border : undefined }}
      onMouseEnter={() => {
        onHover(block.block_index);
        setHovering(true);
      }}
      onMouseLeave={() => {
        onHover(null);
        setHovering(false);
      }}
      onClick={() => handleClick(onClick, block.block_index)}
      onDoubleClick={(event) => void startEditing(event)}
    >
      <div className="mb-1 flex items-center gap-2">
        <BlockLabel label={block.block_label} colors={colors} />
        {myEntry !== undefined && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {t("block.saved")}
          </span>
        )}
      </div>

      {/* No `text-sm`: the size comes from `.markdown-body` (index.css), which is
          driven by the reading font size the user picked in settings. */}
      <div className="leading-relaxed markdown-body" dir="auto">
        {isImageBlock(block) ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground italic">
            <Image className="h-3.5 w-3.5" />
            {t("block.image")}
          </span>
        ) : isTableBlock(block) ? (
          block.block_content ? (
            <div dangerouslySetInnerHTML={{ __html: content ?? "" }} />
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground italic">
              <Table2 className="h-3.5 w-3.5" />
              {t("block.table")}
            </span>
          )
        ) : block.block_content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeRaw]}>
            {content ?? ""}
          </ReactMarkdown>
        ) : (
          <span className="text-muted-foreground italic">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            {t("block.empty")}
          </span>
        )}
      </div>

      {/* How an edit starts: the pencil on hover, or a double click. Only in page-flip
          mode — a page is the unit the file is written in, and editing a page while the
          reader scrolls through many is how a reader loses their place. */}
      {editable && hovering && (
        <button
          className="absolute right-1 bottom-1 rounded-md bg-accent p-1 text-muted-foreground hover:text-foreground hover:bg-primary/20 transition-colors"
          onClick={(event) => void startEditing(event)}
          title={t("block.edit")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}

      {myEntry !== undefined && (
        <button
          className="absolute right-8 bottom-1 inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            void undo();
          }}
          disabled={saving}
          title={t("block.undo")}
        >
          <Undo2 className="h-3 w-3" />
          {t("block.undo")}
        </button>
      )}
    </div>
  );
}

/** The label chip, shared by the reading and the editing states. */
function BlockLabel({
  label,
  colors,
}: {
  label: string;
  colors: { bg: string; border: string; text: string };
}) {
  return (
    <span
      className="block-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={
        {
          backgroundColor: colors.bg,
          border: `1px solid ${colors.border}`,
          // Read by .block-badge in index.css, which lightens it in dark mode.
          "--block-fg": colors.text,
        } as React.CSSProperties
      }
    >
      {formatLabel(label)}
    </span>
  );
}
