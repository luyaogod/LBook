import { useRef, useEffect, useCallback, useState } from "react";
import { fetchPdfPage } from "@/api/pdfs";
import { useBookChange } from "./useBookChange";
import type { OcrPage } from "@/types";

export function useFlowPages(uid: string): {
  getPage: (pageNum: number) => OcrPage | undefined;
  prefetch: (pageNums: number[]) => void;
  version: number;
} {
  const cacheRef = useRef<Map<number, OcrPage>>(new Map());
  const inFlightRef = useRef<Set<number>>(new Set());
  const [version, setVersion] = useState(0);
  const changeVersion = useBookChange(uid);

  // Clear the cache when another book is opened.
  useEffect(() => {
    cacheRef.current.clear();
    inFlightRef.current.clear();
    setVersion(0);
  }, [uid, changeVersion]);

  const getPage = useCallback((pageNum: number): OcrPage | undefined => {
    return cacheRef.current.get(pageNum);
  }, []);

  const prefetch = useCallback(
    (pageNums: number[]) => {
      const toFetch = pageNums.filter(
        (n) => n >= 1 && !cacheRef.current.has(n) && !inFlightRef.current.has(n)
      );

      for (const pageNum of toFetch) {
        inFlightRef.current.add(pageNum);

        fetchPdfPage(uid, pageNum)
          .then((data) => {
            // A null result means the OCR JSON has no such page.
            if (data) cacheRef.current.set(pageNum, data);
            inFlightRef.current.delete(pageNum);
            setVersion((v) => v + 1);
          })
          .catch((err) => {
            console.error(`Failed to fetch page ${pageNum}:`, err);
            inFlightRef.current.delete(pageNum);
          });
      }
    },
    [uid]
  );

  return { getPage, prefetch, version };
}
