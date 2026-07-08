import { BlockCard } from "./BlockCard";
import type { OcrBlock } from "@/types";
import { CheckCircle, Copy, Loader2, AlignLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface OcrSidebarProps {
  blocks: OcrBlock[];
  pageNum: number;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  loading?: boolean;
  markdownText?: string | null;
}

export function OcrSidebar({
  blocks,
  pageNum,
  highlightedBlockId,
  onBlockHover,
  loading = false,
  markdownText,
}: OcrSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"blocks" | "markdown">("blocks");

  const totalChars = blocks.reduce(
    (sum, b) => sum + (b.block_content?.length ?? 0),
    0
  );
  const textBlocks = blocks.filter((b) => !["image", "header_image", "footer_image"].includes(b.block_label));

  function handleCopyAll() {
    const text = textBlocks
      .map((b) => b.block_content)
      .filter(Boolean)
      .join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyMarkdown() {
    if (markdownText) {
      navigator.clipboard.writeText(markdownText).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <Button
          variant={viewMode === "blocks" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setViewMode("blocks")}
        >
          <AlignLeft className="mr-1 h-3.5 w-3.5" />
          Blocks
        </Button>
        {markdownText && (
          <Button
            variant={viewMode === "markdown" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setViewMode("markdown")}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            Markdown
          </Button>
        )}
        <span className="ml-2 text-xs text-muted-foreground">
          Page {pageNum}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={viewMode === "markdown" ? handleCopyMarkdown : handleCopyAll}
          title={viewMode === "markdown" ? "Copy markdown" : "Copy all text"}
        >
          {copied ? (
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && blocks.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading OCR data...</span>
          </div>
        )}
        {viewMode === "markdown" && markdownText ? (
          <div className="text-sm leading-relaxed markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {markdownText}
            </ReactMarkdown>
          </div>
        ) : (
          <>
            {!loading && blocks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No blocks on this page
              </p>
            )}
            {blocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                isHighlighted={block.id === highlightedBlockId}
                onHover={onBlockHover}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground">
        <span>
          {viewMode === "markdown"
            ? `${markdownText?.length ?? 0} chars`
            : `${blocks.length} blocks · ${textBlocks.length} text · ${totalChars} chars`}
        </span>
        <span>Page {pageNum}</span>
      </div>
    </aside>
  );
}
