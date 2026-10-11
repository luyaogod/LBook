import { BlockCard } from "./BlockCard";
import { MarkdownPane } from "./MarkdownPane";
import { describeEntry, useEditHistory } from "@/hooks/useEditHistory";
import { snippetOf } from "@/lib/editHistory";
import { writeErrorText } from "@/lib/writeError";
import type { OcrBlock } from "@/types";
import { PageNav } from "@/components/viewer/PageNav";
import { SelectionPopup } from "@/components/translate/SelectionPopup";
import { useFlowPages } from "@/hooks/useFlowPages";
import { CheckCircle, Copy, Loader2, AlignLeft, FileText, Eye, EyeOff, ArrowLeftRight, ArrowDownUp, Maximize2, Minimize2, PanelRightClose, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
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

/** Blocks a reader cares about; image-only blocks are the PDF's business. */
function textBlocksOf(blocks: OcrBlock[]): OcrBlock[] {
  return blocks.filter(
    (b) => !["image", "header_image", "footer_image"].includes(b.block_label)
  );
}

/** One page kept above the reader's position, and three appended per scroll. */
const FLOW_PAGES_BEFORE = 1;
const FLOW_APPEND_STEP = 3;

// Hide images when rendering markdown (markdown view mode).
const markdownComponents = {
  img: () => null,
};

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
  /**
   * Book uid: identity, asset-URL prefix and the key for the panel's own page
   * loading when it fills the row.
   */
  bookUid?: string;
  /** True when the page area is hidden and this panel fills the row. */
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  /** Hides this panel entirely; the toolbar brings it back. */
  onCollapse: () => void;
  /** Page count, for the navigator shown while expanded. */
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Jump requested from the toolbar/TOC, consumed here while expanded. */
  scrollToPage?: number | null;
  onScrollToPageHandled?: () => void;
  /** Reports the page being read, so progress and the TOC stay in step. */
  onVisiblePageChange?: (pageNum: number, blocks: OcrBlock[], markdownText: string | null) => void;
  /** Opens the settings panel from the translation card's error state. */
  onOpenSettings?: () => void;
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

function PageFooterDivider({
  blocks,
  pageNum,
  onEditPage,
}: {
  blocks: OcrBlock[];
  pageNum: number;
  /** Present in flow mode: correcting content is done a page at a time, so this is the
   * way from "I am scrolling" to "I am fixing this page", landing on the same page. */
  onEditPage?: (pageNum: number) => void;
}) {
  const { t } = useTranslation();
  const { totalChars, textBlocks } = computePageStats(blocks);
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-t border-border px-4 text-[11px] text-muted-foreground my-3 pt-2">
      <span>
        {t("sidebar.stats", {
          blocks: blocks.length,
          text: textBlocks.length,
          chars: totalChars,
        })}
      </span>
      <span className="flex items-center gap-2">
        {onEditPage && (
          <button
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
            onClick={() => onEditPage(pageNum)}
            title={t("sidebar.editThisPage")}
          >
            <Pencil className="h-3 w-3" />
            {t("sidebar.editThisPage")}
          </button>
        )}
        <span>{t("sidebar.page", { page: pageNum })}</span>
      </span>
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
  bookUid,
  expanded,
  onExpandedChange,
  onCollapse,
  totalPages,
  onPageChange,
  scrollToPage,
  onScrollToPageHandled,
  onVisiblePageChange,
  onOpenSettings,
}: OcrSidebarProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // Markdown is the default: it is the shape the text was reconstructed into,
  // and the one a proof-reader reads top to bottom.
  const [viewMode, setViewMode] = useState<"blocks" | "markdown">("markdown");
  /**
   * The pane's buttons live in this footer row, not in the pane.
   *
   * They used to sit above the text (an "Edit" button) or under a short editor (Cancel and
   * Save), which meant the actions were wherever the content happened to end. The footer is
   * outside the scrolling area, so they are always in the same place, always reachable, and
   * the reading view is nothing but the page.
   */
  const [paneActions, setPaneActions] = useState<HTMLDivElement | null>(null);
  /** While the editor is open it owns the area: no padding, and no second scrollbar. */
  const [markdownEditing, setMarkdownEditing] = useState(false);
  /**
   * The session's corrections to this book, and the way to reverse the last one.
   *
   * This is the panel's, not the editors': an editor offers to undo *its own* save, and
   * that button has to keep meaning its own. But after flipping a few pages the reader
   * needs the other one — "put back what I just did", wherever it was.
   */
  const { entries: editHistory, undo: undoEdit } = useEditHistory(bookUid);
  const [undoError, setUndoError] = useState<string | null>(null);
  const lastEdit = editHistory.length > 0 ? (editHistory[editHistory.length - 1] ?? null) : null;
  const listRef = useRef<HTMLDivElement>(null);
  const prevPageNumRef = useRef(pageNum);

  /**
   * Expanded + flow means the page area — and with it the FlowViewer, which is
   * what normally feeds `flowPagesData` — is unmounted. Left alone the panel
   * would sit on "Scroll to load pages..." forever, so it loads its own pages
   * and drives its own scroll position instead.
   */
  const selfFlow = expanded && flowMode && Boolean(bookUid);
  const { getPage, prefetch, version } = useFlowPages(bookUid ?? "");
  const [flowWindow, setFlowWindow] = useState({ from: 1, to: 3 });
  const reportedPageRef = useRef(0);

  /** Pages this panel renders: one before the reader, three ahead. */
  const windowFor = useCallback(
    (page: number) => {
      const from = Math.max(1, page - FLOW_PAGES_BEFORE);
      const to = Math.min(Math.max(totalPages, 1), page + FLOW_APPEND_STEP);
      return { from, to };
    },
    [totalPages]
  );

  const prefetchRange = useCallback(
    (from: number, to: number) => {
      const range: number[] = [];
      for (let p = from; p <= to; p++) range.push(p);
      prefetch(range);
    },
    [prefetch]
  );

  // Entering the panel (or switching books) starts the window at the page the
  // reader was on.
  useEffect(() => {
    if (!selfFlow) return;
    const next = windowFor(pageNum);
    setFlowWindow(next);
    prefetchRange(next.from, next.to);
    // `pageNum` is deliberately not a dependency: it also changes as a result of
    // this panel's own scrolling, and re-centring on every report would fight
    // the reader. Jumps arrive through `scrollToPage` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfFlow, bookUid, totalPages]);

  // A jump from the toolbar or the table of contents re-centres the window.
  useEffect(() => {
    if (!selfFlow || scrollToPage == null) return;
    const next = windowFor(scrollToPage);
    setFlowWindow(next);
    prefetchRange(next.from, next.to);
    const timer = setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-page-num="${scrollToPage}"]`)
        ?.scrollIntoView({ block: "start" });
      onScrollToPageHandled?.();
    }, 60);
    return () => clearTimeout(timer);
  }, [selfFlow, scrollToPage, windowFor, prefetchRange, onScrollToPageHandled]);

  // Scrolling drives both the growth of the window and the "current page"
  // report, so the TOC highlight and the saved progress keep up.
  useEffect(() => {
    if (!selfFlow) return;
    const container = listRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;

        if (
          container.scrollTop + container.clientHeight >
          container.scrollHeight - 700
        ) {
          setFlowWindow((current) => {
            if (current.to >= totalPages) return current;
            const to = Math.min(totalPages, current.to + FLOW_APPEND_STEP);
            prefetchRange(current.to + 1, to);
            return { from: current.from, to };
          });
        }

        const sections = container.querySelectorAll<HTMLElement>("[data-page-num]");
        let current = reportedPageRef.current;
        for (const section of sections) {
          if (section.offsetTop - container.offsetTop <= container.scrollTop + 8) {
            current = Number(section.dataset.pageNum);
          } else {
            break;
          }
        }
        if (current && current !== reportedPageRef.current) {
          reportedPageRef.current = current;
          const page = getPage(current);
          onVisiblePageChange?.(
            current,
            page ? textBlocksOf(page.blocks) : [],
            page?.markdown_text ?? null
          );
        }
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [selfFlow, totalPages, prefetchRange, getPage, onVisiblePageChange]);

  // When this panel drives the scroll, following the PDF's page back is wrong:
  // the report comes from the panel in the first place.
  useEffect(() => {
    if (scrollToBlockId === null) return;
    const el = listRef.current?.querySelector(`[data-block-id="${scrollToBlockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToBlockId]);

  // Flow mode: scroll sidebar to current page section when page changes
  useEffect(() => {
    if (!flowMode || selfFlow) return;
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
  }, [flowMode, selfFlow, pageNum]);

  /**
   * What flow mode renders: this panel's own window of pages, or the viewer's
   * report. `version` is what makes a freshly arrived page appear — the cache
   * itself is a ref.
   */
  const flowPages: FlowPageData[] = useMemo(() => {
    if (!selfFlow) return flowPagesData ?? [];
    const pages: FlowPageData[] = [];
    for (let p = flowWindow.from; p <= flowWindow.to; p++) {
      const page = getPage(p);
      pages.push({
        pageNum: p,
        blocks: page ? textBlocksOf(page.blocks) : [],
        markdownText: page?.markdown_text ?? null,
      });
    }
    return pages;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfFlow, flowPagesData, flowWindow, getPage, version]);

  // Single-page stats (for page-flip mode)
  const { totalChars, textBlocks } = computePageStats(blocks);

  function handleCopyAll() {
    let text: string;
    if (flowMode) {
      // Flow mode: copy every page currently loaded
      text = flowPages
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
    if (flowMode) {
      text = flowPages
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
    ? flowPages.some((p) => p.markdownText != null)
    : markdownText != null;

  // Markdown is the default, but a page whose OCR carries none shows the blocks
  // instead — and the buttons must highlight whichever one is really on screen.
  const effectiveMode = viewMode === "markdown" && hasMarkdown ? "markdown" : "blocks";

  const runUndo = useCallback(
    async (entry: NonNullable<typeof lastEdit>) => {
      const outcome = await undoEdit(entry);
      // A refusal means the file moved on (edited outside the app, or the correction was
      // already put back). Say so, and leave the entry there rather than pretending.
      setUndoError(outcome.ok ? null : writeErrorText(t, { error: outcome.error ?? "", code: outcome.code }));
    },
    [undoEdit, t],
  );

  /**
   * Ctrl+Z, as long as the reader is not typing.
   *
   * Inside a textarea Ctrl+Z belongs to the textarea — that is the browser's own undo of
   * what is being typed, and taking it away would be a bug, not a feature. So a key press
   * that reaches a field is left alone, and this only handles the "nothing is open, put
   * back what I just did" case.
   */
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (element === null) return false
      const tag = element.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || event.shiftKey) return
      if (!event.ctrlKey && !event.metaKey) return
      if (isTyping(event.target)) return
      if (lastEdit === null) return
      event.preventDefault()
      void runUndo(lastEdit)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [lastEdit, runUndo]);

  /** Leaves flow mode on the page the reader pointed at, which is where editing lives. */
  const editPageInFlipMode = useCallback(
    (page: number) => {
      onPageChange(page);
      onFlowModeChange(false);
    },
    [onPageChange, onFlowModeChange],
  );

  return (
    <aside
      className={
        expanded
          ? "flex min-w-0 flex-1 flex-col bg-card"
          : "flex shrink-0 flex-col border-l border-border bg-card"
      }
      // Expanded mode has no page area to size against, so the width is
      // whatever the row has left instead of the dragged value.
      style={expanded ? undefined : { width }}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        {/* Expanded over the page area, the toolbar goes with it — so that row's
            own controls (page navigation, and the button that puts the panel
            away) reappear at the left end, where the toolbar's row began. */}
        {expanded && (
          <>
            <PageNav pageNum={pageNum} totalPages={totalPages} onPageChange={onPageChange} />
            <Button variant="ghost" size="icon-sm" onClick={onCollapse} title={t("sidebar.hide")}>
              <PanelRightClose className="h-4 w-4" />
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
          </>
        )}

        {/* Markdown first: it is the default view. */}
        {hasMarkdown && (
          <Button
            variant={effectiveMode === "markdown" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setViewMode("markdown")}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            {t("sidebar.markdown")}
          </Button>
        )}
        <Button
          variant={effectiveMode === "blocks" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setViewMode("blocks")}
        >
          <AlignLeft className="mr-1 h-3.5 w-3.5" />
          {t("sidebar.blocks")}
        </Button>
        <Button
          variant={overlayOpaque ? "secondary" : "ghost"}
          size="icon-sm"
          className="h-7 w-7"
          onClick={() => onOverlayOpaqueChange(!overlayOpaque)}
          title={overlayOpaque ? t("sidebar.makeOverlaysTransparent") : t("sidebar.makeOverlaysOpaque")}
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
          title={flowMode ? t("sidebar.pageMode") : t("sidebar.scrollMode")}
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
          onClick={effectiveMode === "markdown" ? handleCopyMarkdown : handleCopyAll}
          title={effectiveMode === "markdown" ? t("sidebar.copyMarkdown") : t("sidebar.copyAll")}
        >
          {copied ? (
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant={expanded ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => onExpandedChange(!expanded)}
          title={expanded ? t("sidebar.showPageAgain") : t("sidebar.useFullWidth")}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>

        {/* The last correction, whichever editor made it. Disabled — not hidden — when
            there is nothing to undo, so the row does not move. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          disabled={lastEdit === null}
          onClick={() => lastEdit !== null && void runUndo(lastEdit)}
          title={
            lastEdit === null
              ? t("undo.nothing")
              : [
                  t("undo.action"),
                  describeEntry(lastEdit, t, snippetOf(lastEdit.after)),
                  editHistory.length > 1 ? t("undo.more", { more: editHistory.length - 1 }) : "",
                ]
                  .filter((part) => part !== "")
                  .join(" — ")
          }
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {undoError !== null && <p className="px-3 pb-1 text-[11px] text-destructive">{undoError}</p>}

      {/* Content */}
      <div
        ref={listRef}
        // Editing: edge to edge and no scrolling here, because the editor fills this box and
        // scrolls itself. Two scrollbars for one document is what the reader complained about.
        className={
          markdownEditing ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-3 space-y-2"
        }
      >
        {/* Selection translation only makes sense in Markdown view: in Blocks view a
            selection is a fragment of a fragment, not a passage someone reads. */}
        <SelectionPopup
          containerRef={listRef}
          enabled={effectiveMode === "markdown"}
          onOpenSettings={onOpenSettings}
        />
        {/* Loading state (page-flip mode only) */}
        {!flowMode && loading && blocks.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t("sidebar.loading")}</span>
          </div>
        )}

        {/* Flow mode: render all loaded pages with per-page footer dividers */}
        {flowMode ? (
          <>
            {flowPages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("sidebar.scrollHint")}</p>
            )}
            {flowPages.map(({ pageNum: pn, blocks: pageBlocks, markdownText: pageMd }) => {
              if (effectiveMode === "markdown" && pageMd) {
                return (
                  <div key={pn} data-page-num={pn} className="space-y-2">
                    {/* The size comes from `.markdown-body` (index.css), driven by
                        the reading font size in settings — not `text-sm`. */}
                    <div className="leading-relaxed markdown-body mb-2">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeRaw]}
                        components={markdownComponents}
                      >
                        {pageMd}
                      </ReactMarkdown>
                    </div>
                    <PageFooterDivider blocks={pageBlocks} pageNum={pn} onEditPage={editPageInFlipMode} />
                  </div>
                );
              }

              return (
                <div key={pn} data-page-num={pn} className="space-y-2">
                  {pageBlocks.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      {t("sidebar.pageLoading", { page: pn })}
                    </p>
                  )}
                  {pageBlocks.map((block) => (
                    <BlockCard
                      key={block.block_index}
                      block={block}
                      isHighlighted={block.block_index === highlightedBlockId}
                      onHover={onBlockHover}
                      onClick={onBlockClick}
                      bookUid={bookUid}
                      // No pageIndex while scrolling: editing is a page-at-a-time
                      // activity, so the pencil is off in flow mode.
                    />
                  ))}
                  <PageFooterDivider blocks={pageBlocks} pageNum={pn} onEditPage={editPageInFlipMode} />
                </div>
              );
            })}
          </>
        ) : null}

        {/* Page-flip mode: single page rendering */}
        {!flowMode && (
          <>
            {effectiveMode === "markdown" && markdownText ? (
              // The pane owns the editing chrome and the editor; the reading view stays
              // here, with the plugins, so there is one way to render OCR Markdown.
              <MarkdownPane
                // Same reason: the editor's "written, undoable" state belongs to this
                // page and must not ride along to the next one.
                key={pageNum}
                uid={bookUid}
                pageIndex={pageNum - 1}
                value={markdownText}
                editable={!loading}
                actionsSlot={paneActions}
                onEditingChange={setMarkdownEditing}
              >
                <div className="leading-relaxed markdown-body">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                    components={markdownComponents}
                  >
                    {markdownText}
                  </ReactMarkdown>
                </div>
              </MarkdownPane>
            ) : (
              <>
                {!loading && blocks.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t("sidebar.empty")}
                  </p>
                )}
                {blocks.map((block) => (
                  <BlockCard
                    // Page in the key: a block index repeats on every page, and the
                    // card holds per-page state (what it just wrote, and its undo).
                    key={`${pageNum}-${block.block_index}`}
                    block={block}
                    isHighlighted={block.block_index === highlightedBlockId}
                    onHover={onBlockHover}
                    onClick={onBlockClick}
                    bookUid={bookUid}
                    // 0-based: the file's own numbering (A8). This is what enables the
                    // inline editor — page-flip mode, one page, one field.
                    pageIndex={pageNum - 1}
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
            {effectiveMode === "markdown"
              ? t("sidebar.chars", { count: markdownText?.length ?? 0 })
              : t("sidebar.stats", {
                  blocks: blocks.length,
                  text: textBlocks.length,
                  chars: totalChars,
                })}
          </span>
          {/* The pane's buttons are portalled in here — see MarkdownPane. Left-aligned, right
              after the counts: the page number keeps the far end to itself. */}
          <div ref={setPaneActions} className="flex flex-1 items-center justify-start gap-1 pl-3" />

          <span>{t("sidebar.page", { page: pageNum })}</span>
        </div>
      )}
    </aside>
  );
}
