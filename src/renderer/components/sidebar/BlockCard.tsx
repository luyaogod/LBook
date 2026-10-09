import { useState, useCallback, useRef } from "react";
import type { OcrBlock } from "@/types";
import { BLOCK_LABEL_COLORS } from "@/components/viewer/blockColors";
import { Image, Table2, FileText, Pencil, Check, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { updateBlock } from "@/api/pdfs";
import { resolveAssetUrls } from "@shared/urls";

interface BlockCardProps {
  block: OcrBlock;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
  onClick: (id: number) => void;
  onUpdated?: () => void;
  /** Book uid, used to point relative image references inside the package. */
  bookUid?: string;
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

function handleClick(onClick: (id: number) => void, blockId: number) {
  const sel = window.getSelection();
  if (sel && sel.toString().length > 0) return; // user is selecting text, skip
  onClick(blockId);
}

export function BlockCard({
  block,
  isHighlighted,
  onHover,
  onClick,
  onUpdated,
  bookUid,
}: BlockCardProps) {
  // PaddleOCR emits `imgs/x.jpg`, which would otherwise resolve against the app
  // origin and 404. Rewriting to lbook://asset/<uid>/... reads it out of the
  // package itself. Absolute URLs are left alone so the CSP keeps blocking them.
  const content =
    bookUid && block.block_content
      ? resolveAssetUrls(block.block_content, bookUid)
      : block.block_content;
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;
  const [hovering, setHovering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(block.block_content ?? "");
  const [saving, setSaving] = useState(false);
  const [editHeight, setEditHeight] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(block.block_content ?? "");
    if (cardRef.current) {
      setEditHeight(cardRef.current.offsetHeight);
    }
    setEditing(true);
  }, [block.block_content]);

  const handleSave = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSaving(true);
    try {
      await updateBlock(block.id, editText);
      block.block_content = editText;
      setEditing(false);
      onUpdated?.();
    } catch {
      // keep editing, user can retry
    } finally {
      setSaving(false);
    }
  }, [block.id, editText, onUpdated]);

  const handleCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
    setEditText(block.block_content ?? "");
  }, [block.block_content]);

  if (editing) {
    return (
      <div
        data-block-id={block.id}
        className="rounded-md border border-primary p-3"
      >
        <div className="mb-1 flex items-center gap-2">
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
            {formatLabel(block.block_label)}
          </span>
        </div>
        <textarea
          className="w-full rounded border border-border bg-background p-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          style={{ height: editHeight ?? "auto" }}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
        <div className="mt-2 flex justify-end gap-1">
          <button
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            onClick={handleCancel}
            disabled={saving}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      data-block-id={block.id}
      className={`relative rounded-md border p-3 transition-colors cursor-pointer group ${
        isHighlighted
          ? "ring-2 ring-primary/50 bg-accent/30"
          : "hover:bg-accent/20"
      }`}
      style={{ borderColor: isHighlighted ? colors.border : undefined }}
      onMouseEnter={() => { onHover(block.id); setHovering(true); }}
      onMouseLeave={() => { onHover(null); setHovering(false); }}
      onClick={() => handleClick(onClick, block.id)}
    >
      <div className="mb-1 flex items-center gap-2">
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
          {formatLabel(block.block_label)}
        </span>
      </div>

      <div className="text-sm leading-relaxed markdown-body" dir="auto">
        {isImageBlock(block) ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground italic">
            <Image className="h-3.5 w-3.5" />
            Image block
          </span>
        ) : isTableBlock(block) ? (
          block.block_content ? (
            <div dangerouslySetInnerHTML={{ __html: content ?? "" }} />
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground italic">
              <Table2 className="h-3.5 w-3.5" />
              Table block
            </span>
          )
        ) : block.block_content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeRaw]}>
            {content ?? ""}
          </ReactMarkdown>
        ) : (
          <span className="text-muted-foreground italic">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            Empty
          </span>
        )}
      </div>

      {/* Edit button — shown on hover */}
      {hovering && (
        <button
          className="absolute right-1 bottom-1 rounded-md bg-accent p-1 text-muted-foreground hover:text-foreground hover:bg-primary/20 transition-colors"
          onClick={handleEdit}
          title="Edit block content"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
