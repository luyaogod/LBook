import { useEffect, useState } from "react";

/**
 * Bumps a counter whenever a file inside this book's folder changes on disk.
 *
 * The data hooks take the counter as an effect dependency, which is what makes an
 * edit made in the reader's own editor show up without restarting the app: main
 * watches the folder (and rescans when the window regains focus), the renderer
 * re-reads, and **nothing but the data changes** — the current page and the scroll
 * position are state this hook never touches, so the reader stays where they were.
 *
 * An empty uid means "any book": that is what the focus rescan sends, because while
 * the window was in the background the renderer cannot know what changed.
 */
export function useBookChange(uid: string | null): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (uid === null) return;
    return window.api.events.onBookChanged((change) => {
      if (change.uid === "" || change.uid === uid) setVersion((v) => v + 1);
    });
  }, [uid]);

  return version;
}
