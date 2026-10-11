import { useEffect, useMemo, useState } from "react";
import { fetchBookToc } from "../api/pdfs";
import { useBookChange } from "./useBookChange";
import { flattenToc } from "@shared/toc";
import type { BookToc } from "../types";

/**
 * What has been loaded for one book. Keeping the id next to the payload is what
 * lets "still loading" be derived during render instead of being set from an
 * effect, which would render the tree once in a stale state first.
 */
interface TocEntry {
  uid: string | null;
  toc: BookToc | null;
  error: string | null;
}

/**
 * Loads a book's table of contents from `toc.json` in its folder.
 *
 * Read-only: the outline is a file the user edits, and the app never writes one
 * back (A5). The viewer displays what the folder holds right now.
 */
export function useBookToc(uid: string | null) {
  const changeVersion = useBookChange(uid);
  const [entry, setEntry] = useState<TocEntry>({ uid: null, toc: null, error: null });

  useEffect(() => {
    if (uid === null) return;

    let cancelled = false;
    fetchBookToc(uid)
      .then((toc) => {
        if (!cancelled) setEntry({ uid, toc, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setEntry({ uid, toc: null, error: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [uid, changeVersion]);

  // A result that belongs to a different book is not a result for this one.
  const current = entry.uid === uid ? entry : null;
  const toc = current?.toc ?? null;
  const error = current?.error ?? null;
  const loading = uid !== null && current === null;

  const nodes = useMemo(() => flattenToc(toc), [toc]);

  return { toc, nodes, loading, error };
}
