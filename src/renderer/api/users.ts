import type { ReadingProgress, User } from "@shared/types"

export function fetchCurrentUser(): Promise<User> {
  return window.api.user.current()
}

/** Resolves to null when the book has never been opened. */
export function fetchReadingProgress(pdfId: number): Promise<ReadingProgress | null> {
  return window.api.progress.get(pdfId)
}

export function saveReadingProgress(pdfId: number, lastPageNum: number): Promise<ReadingProgress> {
  return window.api.progress.save(pdfId, lastPageNum)
}
