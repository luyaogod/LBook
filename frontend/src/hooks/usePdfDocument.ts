import { useState, useEffect } from "react";
import { fetchPdfDetail } from "../api/pdfs";
import type { PdfDocumentDetail } from "../types";

export function usePdfDocument(pdfId: number | null) {
  const [pdf, setPdf] = useState<PdfDocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pdfId === null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPdfDetail(pdfId)
      .then((data) => {
        if (!cancelled) setPdf(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  return { pdf, loading, error };
}
