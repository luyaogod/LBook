import { useRef, useEffect, useCallback } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useTranslation } from "react-i18next";
import { PdfPageUnit } from "./PdfPageUnit";
import type { OcrBlock } from "@/types";
import { Loader2 } from "lucide-react";

interface PdfViewerProps {
  /** The document, owned by `App` so that switching views does not re-open the PDF. */
  pdfDoc: PDFDocumentProxy | null;
  pdfLoading: boolean;
  pdfError: string | null;
  pageNum: number;
  scale: number;
  blocks: OcrBlock[];
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  onPageSizeReady: (width: number, height: number) => void;
  ocrPageWidth: number | null;
  ocrPageHeight: number | null;
  overlayOpaque: boolean;
  onWheelZoom: (delta: number) => void;
  scrollToBlockId: number | null;
  onBlockClick: (id: number) => void;
}

export function PdfViewer({
  pdfDoc,
  pdfLoading: loading,
  pdfError: error,
  pageNum,
  scale,
  blocks,
  highlightedBlockId,
  onBlockHover,
  onPageSizeReady,
  ocrPageWidth,
  ocrPageHeight,
  overlayOpaque,
  onWheelZoom,
  scrollToBlockId,
  onBlockClick,
}: PdfViewerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const onWheelZoomRef = useRef(onWheelZoom);
  onWheelZoomRef.current = onWheelZoom;



  /**
   * Warm the neighbours so the next flip has nothing to parse.
   *
   * A flip's first paint on the heaviest book here is 60–90ms, and most of it is
   * pdf.js building the page's operator list, not the painting. Doing that work
   * for page±1 while the reader is still on the current page moves it off the
   * critical path. It waits for idle first: starting it eagerly competes with the
   * page being displayed, which is exactly what we are trying to avoid.
   */
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    const warm = () => {
      if (cancelled) return;
      for (const n of [pageNum + 1, pageNum - 1]) {
        if (n < 1 || n > pdfDoc.numPages) continue;
        pdfDoc
          .getPage(n)
          .then((page) => (cancelled ? undefined : page.getOperatorList()))
          .catch(() => {
            // A neighbour that fails to parse is not worth reporting: the reader
            // has not asked for it, and the real render will surface the error.
          });
      }
    };

    const idle: number =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warm, { timeout: 1500 })
        : window.setTimeout(warm, 400);

    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [pdfDoc, pageNum]);

  // Wheel zoom: use native listener with passive=false to prevent browser zoom
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

  // Scroll to block when clicked in sidebar
  useEffect(() => {
    if (scrollToBlockId === null) return;
    const el = containerRef.current?.querySelector(
      `[data-block-id="${scrollToBlockId}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrollToBlockId]);

  const handleBlockHover = useCallback(
    (id: number | null) => {
      onBlockHover(id);
    },
    [onBlockHover]
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <p>{t("viewer.failedToLoadPdf", { message: error })}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[#f8fafc] dark:bg-background">
      <div className="flex min-h-full items-start justify-start p-4">
        {loading && (
          <div className="mx-auto flex items-center gap-2 text-muted-foreground py-20">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("viewer.loadingPdf")}
          </div>
        )}
        {!loading && pdfDoc && (
          <div className="mx-auto">
            <PdfPageUnit
              pdfDoc={pdfDoc}
              pageNum={pageNum}
              scale={scale}
              blocks={blocks}
              highlightedBlockId={highlightedBlockId}
              onBlockHover={handleBlockHover}
              onBlockClick={onBlockClick}
              overlayOpaque={overlayOpaque}
              ocrPageWidth={ocrPageWidth}
              ocrPageHeight={ocrPageHeight}
              onPageSizeReady={onPageSizeReady}
              className="shadow-lg"
            />
          </div>
        )}
      </div>
    </div>
  );
}
