import { useRef, useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { BlockOverlayLayer } from "./BlockOverlayLayer";
import type { OcrBlock } from "@/types";

interface PdfPageUnitProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNum: number;
  scale: number;
  blocks: OcrBlock[];
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  onBlockClick: (id: number) => void;
  overlayOpaque: boolean;
  ocrPageWidth: number | null;
  ocrPageHeight: number | null;
  onPageSizeReady?: (width: number, height: number) => void;
  className?: string;
}

export function PdfPageUnit({
  pdfDoc,
  pageNum,
  scale,
  blocks,
  highlightedBlockId,
  onBlockHover,
  onBlockClick,
  overlayOpaque,
  ocrPageWidth,
  ocrPageHeight,
  onPageSizeReady,
  className,
}: PdfPageUnitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [pdfPageSize, setPdfPageSize] = useState({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDoc.getPage(pageNum).then((page) => {
      if (cancelled) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const viewport = page.getViewport({ scale: 1.0 });
      setPdfPageSize({ width: viewport.width, height: viewport.height });
      onPageSizeReady?.(viewport.width, viewport.height);

      const scaledViewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      const renderViewport = page.getViewport({ scale: scale * dpr });

      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = `${scaledViewport.width}px`;
      canvas.style.height = `${scaledViewport.height}px`;
      setCanvasSize({
        width: Math.floor(scaledViewport.width),
        height: Math.floor(scaledViewport.height),
      });

      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) return;

      const renderContext = {
        canvasContext,
        viewport: renderViewport,
      };

      try {
        const task = page.render(renderContext);
        renderTaskRef.current = task;
        task.promise
          .then(() => {
            if (!cancelled) {
              renderTaskRef.current = null;
            }
          })
          .catch((err) => {
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

  return (
    <div
      className={`relative shrink-0 ${className ?? ""}`}
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
        onBlockHover={onBlockHover}
        pdfPageWidth={pdfPageSize.width}
        pdfPageHeight={pdfPageSize.height}
        ocrPageWidth={ocrPageWidth}
        overlayOpaque={overlayOpaque}
        ocrPageHeight={ocrPageHeight}
        onBlockClick={onBlockClick}
      />
    </div>
  );
}
