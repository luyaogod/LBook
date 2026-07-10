import { BlockCard } from "./BlockCard";
import type { OcrBlock } from "@/types";
import { CheckCircle, Copy, Loader2, AlignLeft, FileText, Eye, EyeOff, ArrowLeftRight, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";

interface FlowPageData {
  pageNum: number;
  blocks: OcrBlock[];
  markdownText: string | null;
}

interface OcrSidebarProps {
  blocks: OcrBlock[];
  pageNum: number;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  loading?: boolean;
  markdownText?: string | null;
  overlayOpaque: boolean;
  onOverlayOpaqueChange: (v: boolean) => void;
  onBlockClick: (id: number) => void;
  scrollToBlockId: number | null;
  width: number;
  flowMode: boolean;
  onFlowModeChange: (v: boolean) => void;
  flowPagesData?: FlowPageData[];
}

function computePageStats(blocks: OcrBlock[]) {
  const totalChars = blocks.reduce(
    (sum, b) => sum + (b.block_content?.length ?? 0),
    0
  );
  const textBlocks = blocks.filter(
    (b) => !["image", "header_image", "footer_image"].includes(b.block_label)
  );
  return { totalChars, textBlocks };
}

function PageFooterDivider({ blocks, pageNum }: { blocks: OcrBlock[]; pageNum: number }) {
  const { totalChars, textBlocks } = computePageStats(blocks);
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground my-3 pt-2">
      <span>
        {blocks.length} blocks · {textBlocks.length} text · {totalChars} chars
      </span>
      <span>Page {pageNum}</span>
    </div>
  );
}

export function OcrSidebar({
  blocks,
  pageNum,
  highlightedBlockId,
  onBlockHover,
  loading = false,
  markdownText,
  overlayOpaque,
  onOverlayOpaqueChange,
  onBlockClick,
  scrollToBlockId,
  width,
  flowMode,
  onFlowModeChange,
  flowPagesData,
}: OcrSidebarProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"blocks" | "markdown">("blocks");
  const listRef = useRef<HTMLDivElement>(null);
  const prevPageNumRef = useRef(pageNum);

  useEffect(() => {
    if (scrollToBlockId === null) return;
    const el = listRef.current?.querySelector(`[data-block-id="${scrollToBlockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToBlockId]);

  // Flow mode: scroll sidebar to current page section when page changes
  useEffect(() => {
    if (!flowMode) return;
    if (pageNum === prevPageNumRef.current) return;
    prevPageNumRef.current = pageNum;

    // Small delay to let new page content render
    const timer = setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-page-num="${pageNum}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [flowMode, pageNum]);

  // Single-page stats (for page-flip mode)
  const { totalChars, textBlocks } = computePageStats(blocks);

  function handleCopyAll() {
    let text: string;
    if (flowMode && flowPagesData) {
      // Flow mode: copy all loaded pages
      text = flowPagesData
        .map(({ pageNum, blocks: pageBlocks }) => {
          const pageTextBlocks = pageBlocks.filter(
            (b) => !["image", "header_image", "footer_image"].includes(b.block_label)
          );
          const pageText = pageTextBlocks
            .map((b) => b.block_content)
            .filter(Boolean)
            .join("\n\n");
          return pageText ? `--- Page ${pageNum} ---\n\n${pageText}` : null;
        })
        .filter(Boolean)
        .join("\n\n\n");
    } else {
      text = textBlocks
        .map((b) => b.block_content)
        .filter(Boolean)
        .join("\n\n");
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleCopyMarkdown() {
    let text: string;
    if (flowMode && flowPagesData) {
      text = flowPagesData
        .map(({ pageNum, markdownText: md }) =>
          md ? `--- Page ${pageNum} ---\n\n${md}` : null
        )
        .filter(Boolean)
        .join("\n\n\n");
    } else if (markdownText) {
      text = markdownText;
    } else {
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // Check if markdown is available (either single page or any flow page)
  const hasMarkdown = flowMode
    ? (flowPagesData && flowPagesData.some((p) => p.markdownText != null))
    : markdownText != null;

  return (
    <aside className="flex shrink-0 flex-col border-l border-border bg-card" style={{ width }}>
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
        {hasMarkdown && (
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
        <Button
          variant={overlayOpaque ? "secondary" : "ghost"}
          size="icon-sm"
          className="h-7 w-7"
          onClick={() => onOverlayOpaqueChange(!overlayOpaque)}
          title={overlayOpaque ? "Make overlays transparent" : "Make overlays opaque"}
        >
          {overlayOpaque ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          onClick={() => onFlowModeChange(!flowMode)}
          title={flowMode ? "Switch to page mode" : "Switch to scroll mode"}
        >
          {flowMode ? (
            <ArrowLeftRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownUp className="h-3.5 w-3.5" />
          )}
        </Button>
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
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Loading state (page-flip mode only) */}
        {!flowMode && loading && blocks.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading OCR data...</span>
          </div>
        )}

        {/* Flow mode: render all loaded pages with per-page footer dividers */}
        {flowMode && flowPagesData ? (
          <>
            {flowPagesData.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Scroll to load pages...
              </p>
            )}
            {flowPagesData.map(({ pageNum: pn, blocks: pageBlocks, markdownText: pageMd }) => {
              if (viewMode === "markdown" && pageMd) {
                return (
                  <div key={pn} data-page-num={pn} className="space-y-2">
                    <div className="text-sm leading-relaxed markdown-body mb-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeRaw]}>
                        {pageMd}
                      </ReactMarkdown>
                    </div>
                    <PageFooterDivider blocks={pageBlocks} pageNum={pn} />
                  </div>
                );
              }

              return (
                <div key={pn} data-page-num={pn} className="space-y-2">
                  {pageBlocks.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Page {pn} — loading...
                    </p>
                  )}
                  {pageBlocks.map((block) => (
                    <BlockCard
                      key={block.id}
                      block={block}
                      isHighlighted={block.id === highlightedBlockId}
                      onHover={onBlockHover}
                      onClick={onBlockClick}
                    />
                  ))}
                  <PageFooterDivider blocks={pageBlocks} pageNum={pn} />
                </div>
              );
            })}
          </>
        ) : null}

        {/* Page-flip mode: single page rendering */}
        {!flowMode && (
          <>
            {viewMode === "markdown" && markdownText ? (
              <div className="text-sm leading-relaxed markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeRaw]}>
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
                    onClick={onBlockClick}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer stats — only in page-flip mode */}
      {!flowMode && (
        <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground">
          <span>
            {viewMode === "markdown"
              ? `${markdownText?.length ?? 0} chars`
              : `${blocks.length} blocks · ${textBlocks.length} text · ${totalChars} chars`}
          </span>
          <span>Page {pageNum}</span>
        </div>
      )}
    </aside>
  );
}
