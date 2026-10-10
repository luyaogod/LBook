import type { BookToc, OcrPage, PdfDocument } from "@shared/types"
import type { OpenBookOutcome } from "@shared/ipc"

/**
 * Thin wrappers over the preload bridge.
 *
 * Books are named by `uid` — the identity written in the book folder's
 * `meta.json` — so nothing here deals in paths except `openBookFolder`, whose
 * paths come from a dialog the main process owns.
 */

export function fetchBooks(): Promise<PdfDocument[]> {
  return window.api.library.list()
}

/** One book's metadata, or null when its folder has gone missing. */
export function fetchBook(uid: string): Promise<PdfDocument | null> {
  return window.api.library.get(uid)
}

/** Asks for a folder. `null` means the user closed the picker. */
export function openBookFolder(dir?: string): Promise<OpenBookOutcome | null> {
  return window.api.library.open(dir)
}

/** Forgets a book. The folder and everything in it stay where they are. */
export function removeBook(uid: string): Promise<boolean> {
  return window.api.library.remove(uid)
}

/** Shows the book folder in the OS file manager. */
export function revealBook(uid: string): Promise<void> {
  return window.api.library.reveal(uid)
}

export function fetchPdfPage(uid: string, pageNum: number): Promise<OcrPage | null> {
  return window.api.book.getPage(uid, pageNum)
}

/** The book's table of contents, read from `toc.json` in the book folder. */
export function fetchBookToc(uid: string): Promise<BookToc | null> {
  return window.api.book.getToc(uid)
}
