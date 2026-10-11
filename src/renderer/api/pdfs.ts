import type { BookToc, OcrPage, PdfDocument } from "@shared/types"
import type {
  BookFileKind,
  CreateBookInput,
  CreateBookPreview,
  EditableField,
  FileKind,
  LeftoverPackages,
  OpenBookOutcome,
  ReplaceFileResult,
  ReplaceRole,
  WriteOutcome,
} from "@shared/ipc"
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

/**
 * Validates the chosen files and reports what a new book would be.
 *
 * Writes nothing: the dialog uses it to show the folder name and page count before
 * the reader commits, and to explain why a set of files will not do.
 */
export function previewBook(input: CreateBookInput): Promise<CreateBookPreview> {
  return window.api.library.previewBook(input)
}

/** Creates the book folder from those files. */
export function createBook(input: CreateBookInput): Promise<WriteOutcome<PdfDocument>> {
  return window.api.library.createBook(input)
}

/** Replaces one of a book's files, or renames it. */
export function replaceBookFile(
  uid: string,
  role: ReplaceRole,
  value: string,
): Promise<WriteOutcome<ReplaceFileResult>> {
  return window.api.book.replaceFile(uid, role, value)
}

/**
 * Correcting content: one field of one page.
 *
 * `pageIndex` is the file's own numbering (0-based, A8) — the component that shows
 * page numbers adds one. `writeField` takes the text the editor loaded as
 * `baseValue`: if the file no longer holds it, the write is refused rather than
 * quietly overwriting somebody else's change.
 */
export function readField(
  uid: string,
  pageIndex: number,
  field: EditableField,
  blockIndex?: number,
): Promise<WriteOutcome<{ value: string | null }>> {
  return window.api.book.readField(uid, pageIndex, field, blockIndex)
}

export function writeField(input: {
  uid: string
  pageIndex: number
  field: EditableField
  blockIndex?: number
  value: string
  baseValue?: string
}): Promise<WriteOutcome<{ charsBefore: number; charsAfter: number; delta: number; pageCount: number }>> {
  return window.api.book.writeField(input)
}

/** Opens the OS file picker. The path it returns is the only kind the app accepts. */
export async function pickFile(kind: FileKind): Promise<string | null> {
  const files = await window.api.dialog.pickFiles(kind)
  return files[0] ?? null
}

/** Opens the OS folder picker; null when the reader closed it. */
/**
 * Points an already-listed book at the folder it lives in now.
 *
 * The folder has to be that book: main compares the uid inside its `.lbook/meta.json`
 * and refuses anything else, so a mis-click cannot swap one book for another.
 */
export function locateBook(uid: string, dir: string): Promise<WriteOutcome<PdfDocument>> {
  return window.api.library.locate(uid, dir)
}

export function pickFolder(defaultPath?: string): Promise<string | null> {
  return window.api.dialog.pickFolder(defaultPath)
}

/** The book's table of contents, read from `toc.json` in the book folder. */
export function fetchBookToc(uid: string): Promise<BookToc | null> {
  return window.api.book.getToc(uid)
}
