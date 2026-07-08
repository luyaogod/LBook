import { BlockCard } from "./BlockCard";
import type { OcrBlock } from "@/types";
import { CheckCircle, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface OcrSidebarProps {
  blocks: OcrBlock[];
  pageNum: number;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  loading?: boolean;
}

export function OcrSidebar({
  blocks,
  pageNum,
  highlightedBlockId,
  onBlockHover,
  loading = false,
}: OcrSidebarProps) {
  const [copied, setCopied] = useState(false);

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

  return (
    <aside className="flex w-[480px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-sm font-medium">OCR Result</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle className="h-3 w-3" />
          Recognized
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={handleCopyAll}
          title="Copy all text"
        >
          {copied ? (
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Block list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && blocks.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading OCR data...</span>
          </div>
        )}
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
      </div>

      {/* Footer stats */}
      <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground">
        <span>
          {blocks.length} blocks · {textBlocks.length} text · {totalChars} chars
        </span>
        <span>Page {pageNum}</span>
      </div>
    </aside>
  );
}
