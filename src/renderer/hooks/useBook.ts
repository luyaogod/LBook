import { useState, useEffect } from "react";
import { fetchBook } from "../api/pdfs";
import { useBookChange } from "./useBookChange";
import type { PdfDocument } from "../types";

/** Loads one book's metadata. `uid` is null on the home page, where nothing is open. */
export function useBook(uid: string | null) {
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeVersion = useBookChange(uid);

  useEffect(() => {
    if (uid === null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBook(uid)
      .then((data) => {
        if (cancelled) return;
        if (data === null) {
          // The folder was moved or its meta.json was deleted while the app was
          // open: the viewer says so instead of rendering an empty book.
          setError("This book is no longer in the library.");
          return;
        }
        setPdf(data);
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
  }, [uid, changeVersion]);

  return { pdf, loading, error };
}
