import type { OcrBlock } from "@/types";

interface PageFooterProps {
  blocks: OcrBlock[];
  pageNum: number;
}

export function PageFooter({ blocks, pageNum }: PageFooterProps) {
  const totalChars = blocks.reduce(
    (sum, b) => sum + (b.block_content?.length ?? 0),
    0
  );
  const textBlocks = blocks.filter(
    (b) => !["image", "header_image", "footer_image"].includes(b.block_label)
  );

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground bg-card">
      <span>
        {blocks.length} blocks · {textBlocks.length} text · {totalChars} chars
      </span>
      <span>Page {pageNum}</span>
    </div>
  );
}
