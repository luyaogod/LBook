import { useRef, useEffect, useCallback, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { getPdfFileUrl } from "@/api/pdfs";
import { BlockOverlayLayer } from "./BlockOverlayLayer";
import type { OcrBlock } from "@/types";
import { Loader2 } from "lucide-react";

// Configure the PDF.js worker
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
}

export function PdfViewer({
  pdfId,
  pageNum,
  scale,
  blocks,
  highlightedBlockId,
  onBlockHover,
  onPageSizeReady,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Load the PDF document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPdfError(null);

    const url = getPdfFileUrl(pdfId);
    pdfjsLib
      .getDocument({ url })
      .promise.then((doc) => {
        if (!cancelled) {
          pdfDocRef.current = doc;
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPdfError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      pdfDocRef.current?.cleanup();
      pdfDocRef.current = null;
    };
  }, [pdfId]);

  // Render the current page
  useEffect(() => {
    const pdfDoc = pdfDocRef.current;
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;
    const canvas = canvasRef.current;

    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled) return;

      const viewport = page.getViewport({ scale: 1.0 });
      onPageSizeReady(viewport.width, viewport.height);

      const scaledViewport = page.getViewport({ scale });
      canvas.width = Math.floor(scaledViewport.width);
      canvas.height = Math.floor(scaledViewport.height);
      canvas.style.width = `${scaledViewport.width}px`;
      canvas.style.height = `${scaledViewport.height}px`;
      setCanvasSize({
        width: Math.floor(scaledViewport.width),
        height: Math.floor(scaledViewport.height),
      });

      page.render({
        canvas: canvas,
        viewport: scaledViewport,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, onPageSizeReady]);

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
    <div ref={containerRef} className="flex-1 overflow-auto bg-muted/30">
      <div className="flex min-h-full items-start justify-center p-4">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-20">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading PDF...
          </div>
        )}
        {!loading && pdfDocRef.current && (
          <div
            className="relative shrink-0 shadow-lg"
            style={{
              width: canvasSize.width || "auto",
              height: canvasSize.height || "auto",
            }}
          >
            <canvas ref={canvasRef} className="block" />
            <BlockOverlayLayer
              blocks={blocks}
              scale={scale}
              highlightedBlockId={highlightedBlockId}
              onBlockHover={handleBlockHover}
            />
          </div>
        )}
      </div>
    </div>
  );
}
