import { useRef, useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { getPdfFileUrl } from "@/api/pdfs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export function usePdfDocumentProxy(pdfId: number): {
  pdfDoc: pdfjsLib.PDFDocumentProxy | null;
  loading: boolean;
  error: string | null;
} {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    pdfDocRef.current = null;

    const url = getPdfFileUrl(pdfId);
    const loadingTask = pdfjsLib.getDocument({ url });

    loadingTask.promise
      .then((doc) => {
        if (!cancelled) {
          pdfDocRef.current = doc;
          setPdfDoc(doc);
          setLoading(false);
        } else {
          doc.cleanup();
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
      if (pdfDocRef.current) {
        pdfDocRef.current.cleanup();
        pdfDocRef.current = null;
      }
    };
  }, [pdfId]);

  return { pdfDoc, loading, error };
}
