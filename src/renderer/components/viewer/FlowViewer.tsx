import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useFlowPages } from "@/hooks/useFlowPages";
import { useTranslation } from "react-i18next";
import { PdfPageUnit } from "./PdfPageUnit";
import type { OcrBlock, OcrPage } from "@/types";
import { Loader2 } from "lucide-react";

interface FlowPageData {
  pageNum: number;
  blocks: OcrBlock[];
  markdownText: string | null;
}

/**
 * How many pages may hold a canvas at once. One screenful is one to two pages at
 * these sizes, so this is "what is on screen plus a page either way" — the rest of
 * the window keeps its data and its spacer, but no bitmap.
 */
const PAINTED_PAGE_LIMIT = 6;

interface FlowViewerProps {
  bookId: string;
  /** The document, owned by `App` so that switching views does not re-open the PDF. */
  pdfDoc: PDFDocumentProxy | null;
  pdfLoading: boolean;
  pdfError: string | null;
  scale: number;
  overlayOpaque: boolean;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  onBlockClick: (id: number) => void;
  onVisiblePageChange: (pageNum: number, blocks: OcrBlock[], markdownText: string | null) => void;
  onVisiblePagesChange?: (pages: FlowPageData[]) => void;
  scrollToBlockId: number | null;
  scrollToPage: number | null;
  onScrollToPageHandled: () => void;
  onWheelZoom: (delta: number) => void;
  initialPage?: number;
}

function filterBlocks(allBlocks: OcrBlock[]): OcrBlock[] {
  return allBlocks.filter(
    (b) => !["image", "header_image", "footer_image"].includes(b.block_label)
  );
}

export function FlowViewer({
  bookId,
  pdfDoc,
  pdfLoading,
  pdfError,
  scale,

  overlayOpaque,
  highlightedBlockId,
  onBlockHover,
  onBlockClick,
  onVisiblePageChange,
  onVisiblePagesChange,
  scrollToBlockId,
  scrollToPage,
  onScrollToPageHandled,
  onWheelZoom,
  initialPage = 1,
}: FlowViewerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pdfPageSizeRef = useRef({ width: 0, height: 0 });
  const onWheelZoomRef = useRef(onWheelZoom);
  onWheelZoomRef.current = onWheelZoom;
  const initialScrollDoneRef = useRef(false);
  const onVisiblePageChangeRef = useRef(onVisiblePageChange);
  onVisiblePageChangeRef.current = onVisiblePageChange;
  const onVisiblePagesChangeRef = useRef(onVisiblePagesChange);
  onVisiblePagesChangeRef.current = onVisiblePagesChange;
  const getPageRef = useRef<(pageNum: number) => OcrPage | undefined>(() => undefined);
  const prefetchRef = useRef<(pageNums: number[]) => void>(() => {});
  const observedElementsRef = useRef<Set<Element>>(new Set());

  /**
   * Pages that own a real canvas.
   *
   * Loading a page (OCR row + `pdfDoc.getPage`) and *painting* it are separate
   * concerns: the window can hold five pages of data for scrolling, but painting
   * all five costs ~100ms each, and they are painted in DOM order — so the page
   * the reader is looking at waits behind the ones below the fold. Measured: 230ms
   * to first paint on a vector-heavy book, versus ~25ms when that page paints
   * alone.
   *
   * A page joins the set when it comes near the viewport (the observer's margin)
   * or when the reader jumps straight to it, and stays painted until it leaves the
   * loaded window — which is what makes scrolling back up instant.
   */
  const [paintedPages, setPaintedPages] = useState<Set<number>>(() => new Set());
  const paintedPagesRef = useRef(paintedPages);
  paintedPagesRef.current = paintedPages;

  const markPainted = useCallback((pageNums: number[]) => {
    const current = paintedPagesRef.current;
    if (pageNums.every((n) => current.has(n))) return;
    const next = new Set(current);
    for (const n of pageNums) next.add(n);
    // A hard cap, oldest first. Without it a fast flick or a long jump can mark
    // dozens of pages, each of which starts a paint that is never cancelled —
    // and the page actually on screen ends up last in that queue.
    while (next.size > PAINTED_PAGE_LIMIT) {
      const oldest = next.values().next().value as number | undefined;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
    paintedPagesRef.current = next;
    setPaintedPages(next);
  }, []);

  // Tracking state for observer callback (refs to avoid stale closures)
  const visibleStateRef = useRef({
    intersectingPages: new Set<number>(),
  });


  const { getPage, prefetch, version } = useFlowPages(bookId);
  const totalPages = pdfDoc?.numPages ?? 0;

  // Keep refs in sync
  getPageRef.current = getPage;
  prefetchRef.current = prefetch;

  const [visibleRange, setVisibleRange] = useState<[number, number]>([1, Math.min(3, totalPages || 3)]);
  const [pageSizeReady, setPageSizeReady] = useState(false);
  const currentPageRef = useRef(1);
  // Get actual PDF page dimensions from pdf.js (not OCR coordinates)
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    setPageSizeReady(false);

    pdfDoc.getPage(1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.0 });
      pdfPageSizeRef.current = {
        width: viewport.width,
        height: viewport.height,
      };
      setPageSizeReady(true);
    }).catch((err) => {
      console.error("Failed to get PDF page size:", err);
      if (!cancelled) setPageSizeReady(true); // proceed with fallback
    });

    return () => { cancelled = true; };
  }, [pdfDoc]);

  // Reset the visible range when another book is opened.
  useEffect(() => {
    setVisibleRange([1, Math.min(3, totalPages || 3)]);
    initialScrollDoneRef.current = false;
    observedElementsRef.current.clear();
  }, [bookId, totalPages]);

  // Report all loaded pages in visible range when range or cache changes
  useEffect(() => {
    if (!onVisiblePagesChangeRef.current) return;
    const pages: FlowPageData[] = [];
    for (let p = visibleRange[0]; p <= visibleRange[1]; p++) {
      const page = getPageRef.current(p);
      pages.push({
        pageNum: p,
        blocks: page ? filterBlocks(page.blocks) : [],
        markdownText: page?.markdown_text ?? null,
      });
    }
    onVisiblePagesChangeRef.current(pages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRange, version]);

  // Create IntersectionObserver once (when container and totalPages are ready)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalPages === 0) return;

    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observedElementsRef.current.clear();
    }

    const state = visibleStateRef.current;
    state.intersectingPages.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;

        for (const entry of entries) {
          const pageNum = parseInt(
            (entry.target as HTMLElement).dataset.pageNum || "0",
            10
          );
          if (!pageNum) continue;

          if (entry.isIntersecting) {
            state.intersectingPages.add(pageNum);
            changed = true;
          } else {
            state.intersectingPages.delete(pageNum);
          }
        }

        if (changed && state.intersectingPages.size > 0) {
          const minPage = Math.max(
            1,
            Math.min(...state.intersectingPages) - 2
          );
          const maxPage = Math.min(
            totalPages,
            Math.max(...state.intersectingPages) + 2
          );

          setVisibleRange([minPage, maxPage]);

          // Only what is actually on screen (plus the ±2 pages the window keeps
          // loaded) gets painted; everything else stays a correctly sized
          // placeholder until it is scrolled into range.
          markPainted([...state.intersectingPages]);

          // Prefetch OCR data
          const range: number[] = [];
          for (let p = minPage; p <= maxPage; p++) {
            range.push(p);
          }
          prefetchRef.current(range);
        }
      },
      {
        root: container,
        // Wider than the load window on purpose: a page must already be painted
        // when it scrolls in, or the reader sees a blank sheet.
        rootMargin: "900px 0px 900px 0px",
        threshold: [0, 0.01],
      }
    );

    observerRef.current = observer;

    // Observe all existing page elements (they were rendered before the observer existed)
    const existingSentinels = container.querySelectorAll("[data-page-num]");
    existingSentinels.forEach((el) => {
      if (!observedElementsRef.current.has(el)) {
        observedElementsRef.current.add(el);
        observer.observe(el);
      }
    });

    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedElementsRef.current.clear();
    };
  }, [totalPages, markPainted]);

  // Callback ref for page elements: observe/unobserve
  const pageElementRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const observer = observerRef.current;
      if (!observer) return;
      // Avoid observing the same element twice
      if (observedElementsRef.current.has(el)) return;
      observedElementsRef.current.add(el);
      observer.observe(el);
    },
    []
  );

  // Forget pages that left the loaded window: their canvases are unmounted anyway
  // (React drops the subtree), and keeping them in the set would make the reader's
  // return to that page skip the paint for a page that no longer has a canvas.
  useEffect(() => {
    const [min, max] = visibleRange;
    const current = paintedPagesRef.current;
    const keep = [...current].filter((n) => n >= min - 2 && n <= max + 2);
    if (keep.length === current.size) return;
    const next = new Set(keep);
    paintedPagesRef.current = next;
    setPaintedPages(next);
  }, [visibleRange]);

  // Wheel zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        onWheelZoomRef.current(e.deltaY > 0 ? -1 : 1);
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Scroll-based current page tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    let lastReportedPage = 0;

    const updateCurrentPage = () => {
      // Before the viewer has positioned itself there is no meaningful "visible
      // page" — the list still sits at the top of the document, and reporting that
      // would overwrite the reader's saved place with page 1. Switching books makes
      // this window easy to hit.
      if (!initialScrollDoneRef.current) return;

      const pageElements = container.querySelectorAll("[data-page]");
      if (pageElements.length === 0) return;

      const containerTop = container.scrollTop;
      const containerMid = containerTop + container.clientHeight / 2;
      let closestPage = 1;
      let closestDist = Infinity;

      for (const el of pageElements) {
        const pageNum = parseInt(
          (el as HTMLElement).dataset.page || "0",
          10
        );
        if (!pageNum) continue;

        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const elTopRelative = rect.top - containerRect.top + container.scrollTop;
        const elMid = elTopRelative + rect.height / 2;
        const dist = Math.abs(elMid - containerMid);

        if (dist < closestDist) {
          closestDist = dist;
          closestPage = pageNum;
        }
      }

      if (closestPage !== lastReportedPage) {
        lastReportedPage = closestPage;
        currentPageRef.current = closestPage;
        const page = getPageRef.current(closestPage);
        const pageBlocks = page ? filterBlocks(page.blocks) : [];
        onVisiblePageChangeRef.current(
          closestPage,
          pageBlocks,
          page?.markdown_text ?? null
        );
      }
    };

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateCurrentPage();
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Initial scroll to page
  useEffect(() => {
    if (initialScrollDoneRef.current || !pdfDoc || totalPages === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const timer = setTimeout(() => {
      const target = container.querySelector(
        `[data-page="${initialPage}"]`
      );
      if (target) {
        target.scrollIntoView({ block: "start" });
        initialScrollDoneRef.current = true;
        const start = Math.max(1, initialPage - 2);
        const end = Math.min(totalPages, initialPage + 2);
        setVisibleRange([start, end]);
        // Paint the page we were asked for first: waiting for the observer to
        // report it would add a frame plus the paint of everything the observer
        // happened to report alongside it.
        markPainted([initialPage]);
        const range: number[] = [];
        for (let p = start; p <= end; p++) {
          range.push(p);
        }
        prefetch(range);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [pdfDoc, initialPage, totalPages, prefetch, markPainted]);

  // Scroll to block
  useEffect(() => {
    if (scrollToBlockId === null) return;
    const container = containerRef.current;
    if (!container) return;

    const el = container.querySelector(
      `[data-block-id="${scrollToBlockId}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToBlockId]);

  // Scroll to page (from toolbar)
  useEffect(() => {
    if (scrollToPage === null) return;
    const container = containerRef.current;
    if (!container) return;

    const target = container.querySelector(
      `[data-page="${scrollToPage}"]`
    );
    if (target) {
      // Instant, not smooth. A smooth scroll to a page twenty pages away *sweeps
      // the viewport across every page in between*, and each of those intersects
      // the observer's margin and asks to be painted — so the destination ends up
      // last in a queue of dozens of paints (measured: 858ms instead of ~130ms).
      // It also puts the reader in front of the page sooner.
      target.scrollIntoView({ block: "start" });
    }
    // Paint the destination on its own before its neighbours: three paints
    // competing for the same worker made the page the reader asked for finish
    // last. The observer picks the neighbours up a frame later.
    markPainted([scrollToPage].filter((n) => n >= 1 && n <= totalPages));
    onScrollToPageHandled();
  }, [scrollToPage, onScrollToPageHandled, markPainted, totalPages]);

  // Compute pages to render
  const pages = useMemo(() => {
    if (!pdfDoc || totalPages === 0) return [];

    const result: Array<{
      pageNum: number;
      inRange: boolean;
      spacerHeight: number;
    }> = [];

    for (let n = 1; n <= totalPages; n++) {
      const inRange = n >= visibleRange[0] && n <= visibleRange[1];
      const naturalHeight = pdfPageSizeRef.current.height;
      const spacerHeight =
        naturalHeight > 0 ? Math.ceil(naturalHeight * scale) : 600;
      result.push({ pageNum: n, inRange, spacerHeight });
    }

    return result;
  }, [pdfDoc, totalPages, visibleRange, scale]);

  if (pdfError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <p>{t("viewer.failedToLoadPdf", { message: pdfError })}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[#f8fafc] dark:bg-background">
      {pdfLoading && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("viewer.loadingPdf")}
        </div>
      )}

      {!pdfLoading && pdfDoc && pageSizeReady && (
        <div className="flex flex-col items-start py-4 gap-3">
          {pages.map(({ pageNum, inRange, spacerHeight }) => {
            const pageWidth = pdfPageSizeRef.current.width > 0
              ? Math.ceil(pdfPageSizeRef.current.width * scale)
              : 0;

            if (inRange) {
              const page = getPage(pageNum);
              const allBlocks = page?.blocks ?? [];
              const pageBlocks = filterBlocks(allBlocks);
              const painted = paintedPages.has(pageNum);

              return (
                <div key={pageNum} className="mx-auto">
                  <div
                    ref={pageElementRef}
                    data-page={pageNum}
                    data-page-num={pageNum}
                    className="flex flex-col shadow-lg"
                    style={{ minHeight: spacerHeight }}
                  >
                    {painted ? (
                      <PdfPageUnit
                        pdfDoc={pdfDoc}
                        pageNum={pageNum}
                        scale={scale}
                        blocks={pageBlocks}
                        highlightedBlockId={highlightedBlockId}
                        onBlockHover={onBlockHover}
                        onBlockClick={onBlockClick}
                        overlayOpaque={overlayOpaque}
                        ocrPageWidth={page?.page_width ?? null}
                        ocrPageHeight={page?.page_height ?? null}
                      />
                    ) : (
                      // Loaded but not painted yet: a sheet of paper of the right
                      // size. Painting it now would queue ahead of the page the
                      // reader is actually looking at.
                      <div
                        className="bg-white"
                        style={{
                          width: pageWidth || "100%",
                          height: spacerHeight,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            }

            // Out of range: render spacer
            return (
              <div key={pageNum} className="mx-auto">
                <div
                  ref={pageElementRef}
                  data-page={pageNum}
                  data-page-num={pageNum}
                  style={{ height: spacerHeight, width: pageWidth || "100%" }}
                />
              </div>
            );
          })}
        </div>
      )}

      {!pdfLoading && pdfDoc && !pageSizeReady && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      )}
    </div>
  );
}
