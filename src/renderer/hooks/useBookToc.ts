import { useEffect, useMemo, useState } from "react";
import { fetchBookToc } from "../api/pdfs";
import { flattenToc } from "@shared/toc";
import type { BookToc } from "../types";

/**
 * What has been loaded for one book. Keeping the id next to the payload is what
 * lets "still loading" be derived during render instead of being set from an
 * effect, which would render the tree once in a stale state first.
 */
interface TocEntry {
  pdfId: number | null;
  toc: BookToc | null;
  error: string | null;
}

/**
 * Loads a book's table of contents out of its `.lbook`.
 *
 * Read-only on purpose: adding, replacing and removing an outline all happen in
 * the home page's upload/edit dialogs, which is where the file is picked. The
 * viewer only ever displays what the package currently holds.
 */
export function useBookToc(pdfId: number | null) {
  const [entry, setEntry] = useState<TocEntry>({ pdfId: null, toc: null, error: null });

  useEffect(() => {
    if (pdfId === null) return;

    let cancelled = false;
    fetchBookToc(pdfId)
      .then((toc) => {
        if (!cancelled) setEntry({ pdfId, toc, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setEntry({ pdfId, toc: null, error: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pdfId]);

  // A result that belongs to a different book is not a result for this one.
  const current = entry.pdfId === pdfId ? entry : null;
  const toc = current?.toc ?? null;
  const error = current?.error ?? null;
  const loading = pdfId !== null && current === null;

  const nodes = useMemo(() => flattenToc(toc), [toc]);

  return { toc, nodes, loading, error };
}
