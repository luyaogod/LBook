import fs from "node:fs"
import path from "node:path"
import { parseBookMeta, type BookMeta } from "../../shared/bookFile"
import { readSpan, scanPageSpans, type PageSpan } from "../lbook/offsetIndex"

/**
 * One book folder, opened for reading.
 *
 * `openBook` reads `meta.json` (a small file) and stops there: the OCR JSON is
 * indexed lazily, so opening a book costs one small read no matter how large the
 * OCR output is. The first `readPage` pays for a scan, and asks for only twice
 * the page it needs, so opening a book on page 1 reads a few hundred kilobytes
 * of a 15 MB JSON rather than all of it. Measured cost of the alternatives is in
 * `.agents/plan/baseline.md`.
 *
 * **No file handle is held.** Each page read opens and closes the file. That is
 * a deliberate trade: on Windows an open handle blocks renaming or moving the
 * file (and sometimes its folder), which is a whole class of "why can't I move
 * my book" bugs; an open/close pair costs 0.01–0.05 ms, against a 16 ms frame.
 *
 * Page numbers are **1-based**, matching the rest of the app (`page_num`,
 * `currentPage`); the JSON array is 0-based (A8: page = array index).
 */

export interface OpenBook {
  readonly dir: string
  readonly meta: BookMeta
  /** Absolute path of the OCR JSON, already checked to exist. */
  readonly ocrPath: string
  readonly pdfPath: string
  /**
   * False when `book.pdf` is missing. Reading the OCR text still works — the
   * library listing is what turns this into "needs repair", not this module.
   */
  readonly hasPdf: boolean
  /** Pages actually present in the OCR JSON (compare with `meta.pageCount`). */
  pageCount(): Promise<number>
  readPage(pageNum: number): Promise<unknown>
}

export async function openBook(dir: string, options: { chunkBytes?: number } = {}): Promise<OpenBook> {
  const metaPath = path.join(dir, "meta.json")
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown
  } catch (error) {
    throw new Error(`cannot read ${metaPath}: ${(error as Error).message}`)
  }

  const parsed = parseBookMeta(raw)
  if (!parsed.ok) throw new Error(`${metaPath}: ${parsed.error}`)
  const meta = parsed.meta

  const ocrPath = path.join(dir, meta.ocrFile)
  if (!fs.existsSync(ocrPath)) {
    throw new Error(`${metaPath} points at ${meta.ocrFile}, which is not in the folder`)
  }

  const pdfPath = path.join(dir, "book.pdf")

  // The index grows on demand: `known` is what has been scanned so far, and
  // `complete` means the scan reached the end of the array (so an out-of-range
  // page is genuinely missing rather than merely unscanned).
  let known: PageSpan[] = []
  let complete = false

  async function ensure(pageNum: number): Promise<void> {
    if (pageNum <= known.length) return
    // The array already ended before this page, so there is nothing left to scan.
    if (complete) return

    // Ask for twice what we need: a reader moving forward page by page then pays
    // for roughly one scan per doubling instead of one per page.
    const want = Math.max(32, pageNum * 2)
    const scanned = await scanPageSpans(ocrPath, { limit: want, chunkBytes: options.chunkBytes })
    known = scanned.spans
    complete = scanned.spans.length < want
  }

  return {
    dir,
    meta,
    ocrPath,
    pdfPath,
    hasPdf: fs.existsSync(pdfPath),

    async pageCount() {
      await ensure(1)
      if (complete) return known.length
      const scanned = await scanPageSpans(ocrPath, { chunkBytes: options.chunkBytes })
      known = scanned.spans
      complete = true
      return known.length
    },

    async readPage(pageNum) {
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        throw new Error(`page numbers start at 1, got ${pageNum}`)
      }
      await ensure(pageNum)
      if (pageNum > known.length) {
        throw new Error(`page ${pageNum} is not in this book (${known.length} pages)`)
      }
      return readSpan(ocrPath, known[pageNum - 1])
    },
  }
}

/** Raw `toc.json` text, or null when the book has no outline. */
export function readTocText(dir: string): string | null {
  const file = path.join(dir, "toc.json")
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

/** Cover file in the book folder, or null. Served straight from disk by the protocol. */
export function coverPath(dir: string): string | null {
  for (const name of ["cover.jpg", "cover.jpeg", "cover.png", "cover.webp", "cover.gif"]) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return file
  }
  return null
}
