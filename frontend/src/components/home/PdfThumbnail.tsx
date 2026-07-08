import { useRef, useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { getPdfFileUrl } from "@/api/pdfs";
import { FileText } from "lucide-react";

interface PdfThumbnailProps {
  pdfId: number;
}

const THUMBNAIL_SCALE = 0.3;

export function PdfThumbnail({ pdfId }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(false);

    const url = getPdfFileUrl(pdfId);
    const loadingTask = pdfjsLib.getDocument({ url });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          doc.cleanup();
          return;
        }
        return doc.getPage(1).then((page) => ({ doc, page }));
      })
      .then((result) => {
        if (cancelled || !result) {
          result?.doc.cleanup();
          return;
        }
        const { doc, page } = result;

        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE });
        const canvasEl = canvasRef.current;
        if (!canvasEl) {
          doc.cleanup();
          return;
        }

        canvasEl.width = Math.floor(viewport.width);
        canvasEl.height = Math.floor(viewport.height);
        canvasEl.style.width = `${viewport.width}px`;
        canvasEl.style.height = `${viewport.height}px`;

        const canvasContext = canvasEl.getContext("2d");
        if (!canvasContext) {
          doc.cleanup();
          return;
        }

        const renderTask = page.render({ canvasContext, viewport });
        renderTask.promise
          .then(() => {
            if (!cancelled) setLoading(false);
            doc.cleanup();
          })
          .catch(() => {
            if (!cancelled) {
              setError(true);
              setLoading(false);
            }
            doc.cleanup();
          });
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [pdfId]);

  if (error) {
    return (
      <div className="w-14 h-20 rounded flex items-center justify-center shrink-0 bg-muted relative overflow-hidden">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-foreground/5" />
      </div>
    );
  }

  return (
    <div className="w-14 h-20 rounded flex items-center justify-center shrink-0 bg-muted relative overflow-hidden">
      {loading && (
        <FileText className="h-6 w-6 text-muted-foreground" />
      )}
      <canvas
        ref={canvasRef}
        className={`block object-cover w-full h-full ${loading ? "hidden" : ""}`}
      />
    </div>
  );
}
