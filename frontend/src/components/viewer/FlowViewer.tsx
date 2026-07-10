import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { usePdfDocumentProxy } from "@/hooks/usePdfDocumentProxy";
import { useFlowPages } from "@/hooks/useFlowPages";
import { PdfPageUnit } from "./PdfPageUnit";
import type { OcrBlock } from "@/types";
import { Loader2 } from "lucide-react";

interface FlowPageData {
  pageNum: number;
  blocks: OcrBlock[];
  markdownText: string | null;
}

interface FlowViewerProps {
  pdfId: number;
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
  pdfId,
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

  // Tracking state for observer callback (refs to avoid stale closures)
  const visibleStateRef = useRef({
    intersectingPages: new Set<number>(),
  });

  const { pdfDoc, loading: pdfLoading, error: pdfError } = usePdfDocumentProxy(pdfId);
  const { getPage, prefetch, version } = useFlowPages(pdfId);
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

  // Reset visible range when pdfId changes
  useEffect(() => {
    setVisibleRange([1, Math.min(3, totalPages || 3)]);
    initialScrollDoneRef.current = false;
    observedElementsRef.current.clear();
  }, [pdfId, totalPages]);

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
        rootMargin: "400px 0px 400px 0px",
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
  }, [totalPages]);

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
        const range: number[] = [];
        for (let p = start; p <= end; p++) {
          range.push(p);
        }
        prefetch(range);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [pdfDoc, initialPage, totalPages, prefetch]);

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
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onScrollToPageHandled();
  }, [scrollToPage, onScrollToPageHandled]);

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
        <p>Failed to load PDF: {pdfError}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[#f8fafc]">
      {pdfLoading && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading PDF...
        </div>
      )}

      {!pdfLoading && pdfDoc && pageSizeReady && (
        <div className="flex flex-col items-center py-4 gap-3">
          {pages.map(({ pageNum, inRange, spacerHeight }) => {
            if (inRange) {
              const page = getPage(pageNum);
              const allBlocks = page?.blocks ?? [];
              const pageBlocks = filterBlocks(allBlocks);

              return (
                <div
                  key={pageNum}
                  ref={pageElementRef}
                  data-page={pageNum}
                  data-page-num={pageNum}
                  className="flex flex-col shadow-lg"
                  style={{ minHeight: spacerHeight }}
                >
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
                </div>
              );
            }

            // Out of range: render spacer
            return (
              <div
                key={pageNum}
                ref={pageElementRef}
                data-page={pageNum}
                data-page-num={pageNum}
                style={{ height: spacerHeight, width: "100%" }}
              />
            );
          })}
        </div>
      )}

      {!pdfLoading && pdfDoc && !pageSizeReady && (
        <div className="flex items-center justify-center gap-2 text-muted-foreground py-20">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading page info...
        </div>
      )}
    </div>
  );
}
