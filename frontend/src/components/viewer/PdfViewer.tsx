import { useRef, useEffect, useCallback, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { getPdfFileUrl } from "@/api/pdfs";
import { BlockOverlayLayer } from "./BlockOverlayLayer";
import type { OcrBlock } from "@/types";
import { Loader2 } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  pdfId: number;
  pageNum: number;
  scale: number;
  blocks: OcrBlock[];
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  onPageSizeReady: (width: number, height: number) => void;
  ocrPageWidth: number | null;
  ocrPageHeight: number | null;
}

export function PdfViewer({
  pdfId,
  pageNum,
  scale,
  blocks,
  highlightedBlockId,
  onBlockHover,
  onPageSizeReady,
  ocrPageWidth,
  ocrPageHeight,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [pdfPageSize, setPdfPageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPdfError(null);
    setPdfDoc(null);
    pdfDocRef.current = null;

    const url = getPdfFileUrl(pdfId);
    const loadingTask = pdfjsLib.getDocument({ url });

    loadingTask.promise.then((doc) => {
      if (!cancelled) {
        pdfDocRef.current = doc;
        setPdfDoc(doc);
        setLoading(false);
      } else {
        doc.cleanup();
      }
    }).catch((err: Error) => {
      if (!cancelled) {
        setPdfError(err.message);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      loadingTask.destroy();
      // Use ref for cleanup, not stale closure state
      if (pdfDocRef.current) {
        pdfDocRef.current.cleanup();
        pdfDocRef.current = null;
      }
    };
  }, [pdfId]);

  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled) return;

      // Check canvas ref inside async callback — it may have been
      // unmounted/remounted since the effect first ran
      const canvas = canvasRef.current;
      if (!canvas) return;

      const viewport = page.getViewport({ scale: 1.0 });
      setPdfPageSize({ width: viewport.width, height: viewport.height });
      onPageSizeReady(viewport.width, viewport.height);

      const scaledViewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      // Create a DPR-scaled viewport so the render fills the canvas bitmap
      const renderViewport = page.getViewport({ scale: scale * dpr });

      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = `${scaledViewport.width}px`;
      canvas.style.height = `${scaledViewport.height}px`;
      setCanvasSize({
        width: Math.floor(scaledViewport.width),
        height: Math.floor(scaledViewport.height),
      });

      // pdf.js v4 expects canvasContext (2D context), not the canvas element
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) return;

      const renderContext = {
        canvasContext,
        viewport: renderViewport,
      };

      try {
        const task = page.render(renderContext);
        renderTaskRef.current = task;
        task.promise.then(() => {
          if (!cancelled) {
            renderTaskRef.current = null;
          }
        }).catch((err) => {
          if (err.name !== "RenderingCancelledException") {
            console.error("PDF render error:", err);
          }
          renderTaskRef.current = null;
        });
      } catch (err) {
        console.error("Failed to start PDF render:", err);
      }
    }).catch((err) => {
      console.error("Failed to get page:", err);
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNum, scale, onPageSizeReady]);

  const handleBlockHover = useCallback(
    (id: number | null) => {
      onBlockHover(id);
    },
    [onBlockHover]
  );

  if (pdfError) {
    return (
      <div className="flex h-full items-center justify-center text-destructive">
        <p>Failed to load PDF: {pdfError}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-[#f8fafc]">
      <div className="flex min-h-full items-start justify-center p-4">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-20">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading PDF...
          </div>
        )}
        {!loading && pdfDoc && (
          <div
            className="relative shrink-0 shadow-lg"
            style={{
              width: canvasSize.width || "auto",
              height: canvasSize.height || "auto",
            }}
          >
            <canvas ref={canvasRef} className="block bg-white" />
            <BlockOverlayLayer
              blocks={blocks}
              scale={scale}
              highlightedBlockId={highlightedBlockId}
              onBlockHover={handleBlockHover}
              pdfPageWidth={pdfPageSize.width}
              pdfPageHeight={pdfPageSize.height}
              ocrPageWidth={ocrPageWidth}
              ocrPageHeight={ocrPageHeight}
            />
          </div>
        )}
      </div>
    </div>
  );
}