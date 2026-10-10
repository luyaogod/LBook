import { useState, useEffect } from "react";
import { fetchPdfPage } from "../api/pdfs";
import type { OcrPage } from "../types";

export function usePdfPage(uid: string | null, pageNum: number) {
  const [page, setPage] = useState<OcrPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (uid === null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPdfPage(uid, pageNum)
      .then((data) => {
        if (!cancelled) setPage(data);
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
  }, [uid, pageNum]);

  return { page, loading, error };
}
