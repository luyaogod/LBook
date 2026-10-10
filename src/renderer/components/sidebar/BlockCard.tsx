import { useRef } from "react";
import type { OcrBlock } from "@/types";
import { BLOCK_LABEL_COLORS } from "@/components/viewer/blockColors";
import { Image, Table2, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { resolveAssetUrls } from "@shared/urls";

/**
 * One OCR block, as plain output.
 *
 * It used to have an edit button that staged a change in the database until the
 * whole book was written back into the .lbook. A book is now a folder of files the
 * reader owns, so changing one means editing `ocr.json` in their own editor — the
 * app is read-only (A5 in `.agents/plan/00-decisions.md`). What is left is what the
 * panel is for: reading the block, highlighting it, and jumping from it to where
 * it sits on the page.
 *
 * A block's identity is its `block_index`, the position inside the page's
 * `parsing_res_list`: there is no id in the OCR file, and hover/scroll wiring only
 * ever compares blocks within one page.
 */
interface BlockCardProps {
  block: OcrBlock;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
  onClick: (id: number) => void;
  /** Book uid, used to point relative image references at the book folder. */
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

function handleClick(onClick: (id: number) => void, blockIndex: number) {
  const sel = window.getSelection();
  if (sel && sel.toString().length > 0) return; // user is selecting text, skip
  onClick(blockIndex);
}

export function BlockCard({ block, isHighlighted, onHover, onClick, bookUid }: BlockCardProps) {
  // PaddleOCR emits `imgs/x.jpg`, which would otherwise resolve against the app
  // origin and 404. Rewriting to lbook://asset/<uid>/... reads it out of the book
  // folder. Absolute URLs are left alone so the CSP keeps blocking them.
  const content =
    bookUid && block.block_content
      ? resolveAssetUrls(block.block_content, bookUid)
      : block.block_content;
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      data-block-id={block.block_index}
      className={`relative rounded-md border p-3 transition-colors cursor-pointer ${
        isHighlighted ? "ring-2 ring-primary/50 bg-accent/30" : "hover:bg-accent/20"
      }`}
      style={{ borderColor: isHighlighted ? colors.border : undefined }}
      onMouseEnter={() => onHover(block.block_index)}
      onMouseLeave={() => onHover(null)}
      onClick={() => handleClick(onClick, block.block_index)}
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

      {/* No `text-sm`: the size comes from `.markdown-body` (index.css), which is
          driven by the reading font size the user picked in settings. */}
      <div className="leading-relaxed markdown-body" dir="auto">
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
    </div>
  );
}
