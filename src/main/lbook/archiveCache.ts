import path from "node:path"
import { ZipArchive } from "./zipIndex"

interface CacheEntry {
  /** The *pending* open, not the resolved archive. See getArchive. */
  archive: Promise<ZipArchive>
  idleTimer: NodeJS.Timeout | null
}

const cache = new Map<string, CacheEntry>()

/** How long an unused archive stays open before its handles are released. */
const IDLE_CLOSE_MS = 60_000
/** Upper bound on simultaneously open archives. */
const MAX_OPEN = 8

function scheduleIdleClose(key: string): void {
  const entry = cache.get(key)
  if (!entry) return
  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  entry.idleTimer = setTimeout(() => void closeArchive(key), IDLE_CLOSE_MS)
  // Do not hold the event loop open just for this timer.
  entry.idleTimer.unref?.()
}

function evictLeastRecentlyUsed(): void {
  while (cache.size > MAX_OPEN) {
    const oldest = cache.keys().next()
    if (oldest.done || oldest.value === undefined) return
    void closeArchive(oldest.value)
  }
}

/**
 * Returns an open archive for `filePath`, opening and caching it on first use.
 *
 * Scanning the central directory of a 200 MB package costs a few hundred KB of
 * reads, so it must not happen once per cover or per asset request.
 */
export async function getArchive(filePath: string): Promise<ZipArchive> {
  const key = path.resolve(filePath)

  const existing = cache.get(key)
  if (existing) {
    // Refresh recency so the LRU eviction below does not close a hot archive.
    cache.delete(key)
    cache.set(key, existing)
    scheduleIdleClose(key)
    return existing.archive
  }

  // Cache the pending open rather than the resolved archive. Two concurrent
  // callers — `Promise.all([readOcrJson(...), pdfSize(...)])` does exactly
  // this — would otherwise both miss the cache, both open the file, and the
  // second set would overwrite the first, leaking a handle that nothing can
  // ever reach again.
  const opening = ZipArchive.open(key).catch((error: unknown) => {
    cache.delete(key)
    throw error
  })

  cache.set(key, { archive: opening, idleTimer: null })
  scheduleIdleClose(key)
  evictLeastRecentlyUsed()
  return opening
}

/**
 * Closes and forgets a cached archive.
 *
 * MUST be awaited before replacing a package on disk: Windows refuses to rename
 * over a file that still has an open handle.
 */
export async function closeArchive(filePath: string): Promise<void> {
  const key = path.resolve(filePath)
  const entry = cache.get(key)
  if (!entry) return

  if (entry.idleTimer) clearTimeout(entry.idleTimer)
  cache.delete(key)

  try {
    await (await entry.archive).close()
  } catch {
    // The open itself failed; there is no handle to release.
  }
}

export async function closeAllArchives(): Promise<void> {
  await Promise.all([...cache.keys()].map((key) => closeArchive(key)))
}

export function openArchiveCount(): number {
  return cache.size
}
