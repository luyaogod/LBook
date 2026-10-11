import fs from "node:fs"
import { promises as fsp } from "node:fs"
import path from "node:path"
import { BOOK_FILES, COVER_NAMES, LBOOK_DIR, parseBookMeta, type BookMeta } from "../../shared/bookFile"
import { readSpan, scanPageSpans, type PageSpan } from "../lbook/offsetIndex"

/**
 * One book folder, opened for reading.
 *
 * A book folder is `book.pdf` next to a `.lbook` directory holding `meta.json`,
 * `ocr.json`, `toc.json` and the cover (see `LBOOK_DIR` in `src/shared/bookFile.ts`).
 * Every path in this module is derived from that one convention, so there is exactly
 * one place to look when asking "where did the OCR file go".
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

/** `mtime` + size of a file: the cheapest fingerprint that changes when it is edited. */
export interface FileFingerprint {
  mtimeMs: number
  size: number
}

/**
 * The two files this module holds state for. A changed `ocr.json` invalidates the
 * page index; a changed `meta.json` invalidates the identity, the title and the page
 * count everything else is checked against.
 */
export interface BookFingerprints {
  meta: FileFingerprint | null
  ocr: FileFingerprint | null
}

export function fingerprintOf(file: string): FileFingerprint | null {
  try {
    const stats = fs.statSync(file)
    return { mtimeMs: stats.mtimeMs, size: stats.size }
  } catch {
    // Gone, unreadable, or behind a drive that is not plugged in: the caller treats
    // "no fingerprint" as "changed" and re-opens.
    return null
  }
}

/** True when the file is still the same file it was when it was read. */
export function sameFingerprint(a: FileFingerprint | null, b: FileFingerprint | null): boolean {
  if (a === null || b === null) return a === b
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

export interface OpenBook {
  /** The book folder: `book.pdf` and `.lbook/` live in here. */
  readonly dir: string
  /** The metadata directory, `dir/.lbook`. */
  readonly dataDir: string
  readonly meta: BookMeta
  /** Absolute path of the OCR JSON, already checked to exist. */
  readonly ocrPath: string
  readonly pdfPath: string
  /**
   * False when `book.pdf` is missing. Reading the OCR text still works — the
   * library listing is what turns this into "needs repair", not this module.
   */
  readonly hasPdf: boolean
  /**
   * True when `meta.json` or `ocr.json` has been written since this instance was
   * opened, so the cached page index and the parsed meta are out of date.
   *
   * Two `stat` calls (≈20µs) against a page read measured at 0.05–0.3ms: cheap
   * enough to ask on every call, which is what keeps a reader who edited a file in
   * their own editor from having to restart the app (B10).
   */
  isStale(): boolean
  /** The fingerprints this instance was opened with, for the watcher to compare. */
  readonly fingerprints: BookFingerprints
  /** Pages actually present in the OCR JSON (compare with `meta.pageCount`). */
  pageCount(): Promise<number>
  readPage(pageNum: number): Promise<unknown>
  /**
   * One page element's absolute byte range **and its bytes**.
   *
   * This is what an edit needs: the range says where in the file the element lives,
   * and the bytes are what the field locator walks (`fieldRange.ts`). Reading the
   * range rather than the whole file is the same reason the reader never parses a
   * 7.9MB document to show one page.
   */
  pageRange(pageNum: number): Promise<{ start: number; end: number; bytes: Buffer }>
}

/** `dir/.lbook` — the metadata directory of a book folder. */
export function dataDirOf(dir: string): string {
  return path.join(dir, LBOOK_DIR)
}

export async function openBook(dir: string, options: { chunkBytes?: number } = {}): Promise<OpenBook> {
  const dataDir = dataDirOf(dir)
  const metaPath = path.join(dataDir, BOOK_FILES.meta)

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown
  } catch (error) {
    throw new Error(`cannot read ${metaPath}: ${(error as Error).message}`)
  }

  const parsed = parseBookMeta(raw)
  if (!parsed.ok) throw new Error(`${metaPath}: ${parsed.error}`)
  const meta = parsed.meta

  const ocrPath = path.join(dataDir, meta.ocrFile)
  if (!fs.existsSync(ocrPath)) {
    throw new Error(`${metaPath} points at ${meta.ocrFile}, which is not in ${dataDir}`)
  }

  const pdfPath = path.join(dir, BOOK_FILES.pdf)

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

  // Read once here rather than on every `isStale()` call: what the comparison needs
  // is the state the *parsed* data came from, not the current state.
  const fingerprints: BookFingerprints = {
    meta: fingerprintOf(metaPath),
    ocr: fingerprintOf(ocrPath),
  }

  return {
    dir,
    dataDir,
    meta,
    ocrPath,
    pdfPath,
    hasPdf: fs.existsSync(pdfPath),

    fingerprints,

    isStale() {
      return (
        !sameFingerprint(fingerprints.meta, fingerprintOf(metaPath)) ||
        !sameFingerprint(fingerprints.ocr, fingerprintOf(ocrPath))
      )
    },

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

    async pageRange(pageNum) {
      if (!Number.isInteger(pageNum) || pageNum < 1) {
        throw new Error(`page numbers start at 1, got ${pageNum}`)
      }
      await ensure(pageNum)
      if (pageNum > known.length) {
        throw new Error(`page ${pageNum} is not in this book (${known.length} pages)`)
      }

      const span = known[pageNum - 1]
      const handle = await fsp.open(ocrPath, "r")
      try {
        const bytes = Buffer.alloc(span.end - span.start)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, span.start)
        if (bytesRead !== bytes.length) {
          throw new Error(`short read of page ${pageNum}: wanted ${bytes.length}, got ${bytesRead}`)
        }
        return { start: span.start, end: span.end, bytes }
      } finally {
        await handle.close()
      }
    },
  }
}

/** Raw `toc.json` text, or null when the book has no outline. */
export function readTocText(dir: string): string | null {
  const file = path.join(dataDirOf(dir), BOOK_FILES.toc)
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

/** Cover file inside the metadata directory, or null. Served from disk by the protocol. */
export function coverPath(dir: string): string | null {
  const dataDir = dataDirOf(dir)
  for (const name of COVER_NAMES) {
    const file = path.join(dataDir, name)
    if (fs.existsSync(file)) return file
  }
  return null
}

/** The PDF at the top of the book folder. */
export function pdfPathOf(dir: string): string {
  return path.join(dir, BOOK_FILES.pdf)
}
