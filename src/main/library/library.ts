import fs from "node:fs"
import { promises as fsp } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { BOOK_FORMAT_VERSION, writeBookMeta, parseBookMeta } from "../../shared/bookFile"
import type { OpenBookOutcome } from "../../shared/ipc"
import type { BookToc, OcrPage, PdfDocument, ReadingProgress } from "../../shared/types"
import { parseToc } from "../../shared/toc"
import { coverUrl } from "../../shared/urls"
import { toOcrPage } from "../lbook/ocr"
import { scanPageSpans } from "../lbook/offsetIndex"
import type { ProgressStore } from "../progress"
import { coverPath, openBook, readTocText, type OpenBook } from "./book"
import type { LedgerStore } from "./ledger"

/**
 * The library: the folders the user registered, read as books.
 *
 * Everything here starts from the ledger (a list of paths, A11) and reads the
 * book on demand. There is no index to keep in step with the disk and no import
 * step: `open()` registers a folder, `list()` describes every registered folder
 * by reading its `meta.json`, and a book that cannot be read right now comes back
 * with a `problem` instead of disappearing (B8).
 *
 * **Open books are cached, but hold no file handle.** `openBook` reads pages by
 * opening and closing the file each time, so a cached book is just the page index
 * it has built so far (tens of kilobytes for a 665-page book) plus the parsed
 * `meta.json`. The cache is dropped when a book is removed and when its folder
 * path changes; picking up an *edited* OCR file without a restart is Phase 2's job
 * (B10), and until then the index of a book the user rewrote mid-session is stale.
 */
export interface Library {
  /** Problems found while loading the ledger, for the settings panel or a log. */
  readonly issues: string[]
  list(): Promise<PdfDocument[]>
  get(uid: string): Promise<PdfDocument | null>
  getPage(uid: string, pageNum: number): Promise<OcrPage | null>
  /** Reads `[begin, end]` — **inclusive**, matching what the PDF transport sends. */
  readPdfRange(uid: string, begin: number, end: number): Promise<Buffer>
  getToc(uid: string): Promise<BookToc | null>
  open(dir: string): Promise<OpenBookOutcome>
  remove(uid: string): boolean
  readonly progress: {
    get(uid: string): ReadingProgress | null
    save(uid: string, pageNum: number): Promise<ReadingProgress>
  }
  dispose(): void
}

export interface LibraryInput {
  ledger: LedgerStore
  progress: ProgressStore
  /** Injected for deterministic tests. */
  now?: () => string
}

export function createLibrary(input: LibraryInput): Library {
  const { ledger, progress } = input
  const now = input.now ?? (() => new Date().toISOString())
  const books = new Map<string, OpenBook>()

  function refOf(uid: string) {
    const ref = ledger.list().find((item) => item.uid === uid)
    if (!ref) throw new Error("this book is no longer in the library")
    return ref
  }

  /**
   * The open book, opened once and kept until its folder moves.
   *
   * The cache is keyed by uid rather than by path so that a book which is renamed
   * around the app keeps the work done on it; the path check is what catches the
   * case where the *entry* changed and the cached index belongs to another folder.
   */
  async function bookFor(uid: string): Promise<OpenBook> {
    const dir = ledger.resolve(refOf(uid))
    const cached = books.get(uid)
    if (cached && cached.dir === dir) return cached

    const book = await openBook(dir)
    books.set(uid, book)
    return book
  }

  /** The renderer's view of one book: what it needs to draw a row. */
  async function describe(uid: string, dir: string): Promise<PdfDocument> {
    // Checked before the cache answers: a folder can be moved away while a book is
    // open, and an in-memory `meta.json` would happily describe a book that is no
    // longer on disk.
    if (!fs.existsSync(dir)) {
      books.delete(uid)
      throw new Error(`the folder is not there: ${dir}`)
    }

    const book = await bookFor(uid)
    const meta = book.meta

    if (!fs.existsSync(book.ocrPath)) {
      books.delete(uid)
      throw new Error(`${meta.ocrFile} is missing from this folder`)
    }

    let fileSize = 0
    let fallbackDate = ""
    try {
      const stats = fs.statSync(book.pdfPath)
      fileSize = stats.size
      fallbackDate = stats.mtime.toISOString()
    } catch {
      // No book.pdf: the OCR text can still be read, so this is reported as a
      // problem on the book rather than treated as a failure to list it.
    }

    return {
      uid,
      title: meta.title || path.basename(dir),
      author: meta.author ?? null,
      page_count: meta.pageCount,
      file_size: fileSize,
      cover_url: coverPath(dir) ? coverUrl(uid) : null,
      created_at: meta.createdAt ?? fallbackDate,
      dir,
      problem: book.hasPdf ? null : "book.pdf is missing from this folder",
    }
  }

  /**
   * Reads a page, turning "there is no such page" into null.
   *
   * `openBook` refuses a page past the end of the array, which is a normal answer
   * here (the viewer's page count comes from `meta.json` and can disagree with the
   * file); the panel shows "no OCR text for this page" — and the reason is logged
   * rather than thrown, because it is a book problem, not an app bug.
   */
  async function pageAt(book: OpenBook, pageNum: number): Promise<unknown | null> {
    try {
      return await book.readPage(pageNum)
    } catch (error) {
      console.warn(`[library] page ${pageNum} of ${book.dir}: ${(error as Error).message}`)
      return null
    }
  }

  /**
   * Turns a folder into a book.
   *
   * A folder that already has a `meta.json` is taken as-is. A folder without one
   * is *adopted*: PaddleOCR's own output is `book.pdf` plus a JSON next to it, and
   * writing that `meta.json` is **creating** the book rather than editing it — the
   * one write the app does, and only when the user asks for a folder to be added.
   * Nothing else in the folder is touched, ever (A5).
   */
  async function adopt(dir: string): Promise<{ uid: string; adopted: boolean }> {
    const metaPath = path.join(dir, "meta.json")
    if (fs.existsSync(metaPath)) {
      const parsed = parseBookMeta(JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown)
      if (!parsed.ok) throw new Error(`meta.json: ${parsed.error}`)
      return { uid: parsed.meta.uid, adopted: false }
    }

    const pdfPath = path.join(dir, "book.pdf")
    if (!fs.existsSync(pdfPath)) {
      throw new Error("this folder has no meta.json and no book.pdf, so it is not a book")
    }

    const candidates = fs
      .readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json") && name !== "meta.json")
    const ocrFile = candidates.includes("ocr.json") ? "ocr.json" : candidates[0]
    if (!ocrFile) {
      throw new Error("this folder has no OCR JSON next to book.pdf, so it is not a book yet")
    }

    const ocrPath = path.join(dir, ocrFile)
    // The page count is the length of the OCR array, which takes one streaming
    // scan of the file. It is the number the reading progress is checked against,
    // so it is worth the ~30ms once, at the moment the user adds the book.
    const scanned = await scanPageSpans(ocrPath)
    if (scanned.spans.length === 0) {
      throw new Error(`${ocrFile} has no pages: it does not look like PaddleOCR output`)
    }

    const uid = randomUUID().replace(/-/g, "")
    const title = path.basename(dir)
    fs.writeFileSync(
      metaPath,
      writeBookMeta({
        formatVersion: BOOK_FORMAT_VERSION,
        uid,
        title,
        pageCount: scanned.spans.length,
        ocrFile,
        createdAt: now(),
        source: `adopted folder (${ocrFile})`,
      }),
      "utf8",
    )
    return { uid, adopted: true }
  }

  return {
    get issues() {
      return ledger.issues
    },

    async list() {
      const described = await Promise.all(
        ledger.list().map(async (ref) => {
          const dir = ledger.resolve(ref)
          try {
            return await describe(ref.uid, dir)
          } catch (error) {
            // A folder that was moved, emptied or hand-edited stays in the list
            // with the reason attached: silently dropping it would look like the
            // book was deleted (B8).
            books.delete(ref.uid)
            return {
              uid: ref.uid,
              title: path.basename(dir),
              author: null,
              page_count: 0,
              file_size: 0,
              cover_url: null,
              created_at: ref.addedAt,
              dir,
              problem: error instanceof Error ? error.message : String(error),
            } satisfies PdfDocument
          }
        }),
      )
      return described
    },

    async get(uid) {
      const ref = ledger.list().find((item) => item.uid === uid)
      if (!ref) return null
      try {
        return await describe(uid, ledger.resolve(ref))
      } catch {
        return null
      }
    },

    async getPage(uid, pageNum) {
      const book = await bookFor(uid)
      const element = await pageAt(book, pageNum)
      return element === null ? null : toOcrPage(element, pageNum, uid)
    },

    async readPdfRange(uid, begin, end) {
      const book = await bookFor(uid)
      const size = fs.statSync(book.pdfPath).size
      const start = Math.max(0, begin)
      const stop = Math.min(end, size - 1)
      if (stop < start) return Buffer.alloc(0)

      // Opened per request rather than held: on Windows an open handle blocks the
      // user from renaming or moving the book, and an open/close pair costs
      // 0.01–0.05ms against pdf.js's ~0.5ms per chunk.
      const handle = await fsp.open(book.pdfPath, "r")
      try {
        const buffer = Buffer.alloc(stop - start + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
        return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
    },

    async getToc(uid) {
      const book = await bookFor(uid)
      const text = readTocText(book.dir)
      if (text === null) return null
      try {
        return parseToc(JSON.parse(text))
      } catch (error) {
        // A malformed outline is reported instead of showing an empty tree: the
        // user just edited this file, and an empty panel would hide the typo.
        throw new Error(`toc.json is invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    },

    async open(dir) {
      try {
        const target = path.resolve(dir)
        if (!fs.existsSync(target)) {
          return { ok: false, error: "that folder does not exist" }
        }
        if (!fs.statSync(target).isDirectory()) {
          return { ok: false, error: "that is a file, not a folder" }
        }

        const { uid, adopted } = await adopt(target)
        const added = ledger.add(target, uid)
        const doc = await describe(uid, target)
        return { ok: true, doc, alreadyKnown: added === null, adopted }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    remove(uid) {
      const ref = ledger.list().find((item) => item.uid === uid)
      if (!ref) return false
      books.delete(uid)
      const removed = ledger.remove(ref)
      if (removed) progress.keep(new Set(ledger.list().map((item) => item.uid)))
      return removed
    },

    progress: {
      get: (uid) => progress.get(uid),

      async save(uid, pageNum) {
        // Checked against `meta.json`, not against the OCR file: this runs on every
        // page turn (debounced) and must not trigger a scan of a 15MB JSON. The
        // count in meta.json is what the viewer pages through anyway.
        const book = await bookFor(uid)
        if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > book.meta.pageCount) {
          throw new Error(`page ${pageNum} is outside 1..${book.meta.pageCount}`)
        }
        return progress.save(uid, pageNum)
      },
    },

    dispose() {
      books.clear()
    },
  }
}
