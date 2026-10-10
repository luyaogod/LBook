import type { ReadingProgress } from "@shared/types"

/** Resolves to null when the book has never been opened. */
export function fetchReadingProgress(uid: string): Promise<ReadingProgress | null> {
  return window.api.progress.get(uid)
}

export function saveReadingProgress(uid: string, lastPageNum: number): Promise<ReadingProgress> {
  return window.api.progress.save(uid, lastPageNum)
}
