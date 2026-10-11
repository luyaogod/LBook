import type { BookToc, OcrPage, PdfDocument } from "@shared/types"
import type { BookFileKind, LeftoverPackages, OpenBookOutcome } from "@shared/ipc"
import type { BookIssue } from "@shared/validateBook"

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

/** Opens a book folder in the OS file manager. */
export function openBookPath(uid: string, kind: BookFileKind = "folder"): Promise<void> {
  return window.api.library.openPath(uid, kind)
}

/** Shows a book's folder (or one of its files) selected in the file manager. */
export function showBookInFolder(uid: string, kind: BookFileKind = "folder"): Promise<void> {
  return window.api.library.showInFolder(uid, kind)
}

/**
 * Runs the validation rules over one book.
 *
 * Deep by default: it parses every page of the OCR file, which is how a page that was
 * edited into a broken state is found and pointed at by byte offset. Roughly 300ms on
 * the largest book here, so it belongs behind a button.
 */
export function inspectBook(uid: string, deep = true): Promise<BookIssue[]> {
  return window.api.library.inspect(uid, deep)
}

/** Old `.lbook` packages still in the default new-book location. */
export function fetchLeftoverPackages(): Promise<LeftoverPackages> {
  return window.api.library.leftovers()
}

/** Opens the default new-book location itself, so the reader can see those files. */
export function openLibraryDir(): Promise<void> {
  return window.api.library.openLibraryDir()
}

export function fetchPdfPage(uid: string, pageNum: number): Promise<OcrPage | null> {
  return window.api.book.getPage(uid, pageNum)
}

/** The book's table of contents, read from `toc.json` in the book folder. */
export function fetchBookToc(uid: string): Promise<BookToc | null> {
  return window.api.book.getToc(uid)
}
