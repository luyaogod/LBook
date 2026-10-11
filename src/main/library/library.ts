import fs from "node:fs"
import { promises as fsp } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  BOOK_FILES,
  BOOK_FORMAT_VERSION,
  COVER_NAMES,
  LBOOK_DIR,
  parseBookMeta,
  writeBookMeta,
  type BookMeta,
} from "../../shared/bookFile"
import type { OpenBookOutcome, WriteOutcome } from "../../shared/ipc"
import type { BookToc, OcrPage, PdfDocument, ReadingProgress } from "../../shared/types"
import { parseToc } from "../../shared/toc"
import { coverUrl } from "../../shared/urls"
import { toOcrPage } from "../lbook/ocr"
import { scanPageSpans } from "../lbook/offsetIndex"
import type { ProgressStore } from "../progress"
import { coverPath, dataDirOf, openBook, readTocText, type OpenBook } from "./book"
import type { LedgerStore } from "./ledger"
import type { BookChange, LibraryWatcher } from "./watch"
import type { BookFileKind } from "../../shared/ipc"

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
  /**
   * A page element's byte range and bytes, for editing.
   *
   * Page numbers here are what the reader sees (1-based); the JSON array the file is
   * made of is 0-based (A8), and the conversion is this method's caller's business.
   */
  pageRange(uid: string, pageNum: number): Promise<{ start: number; end: number; bytes: Buffer }>
  /** Reads `[begin, end]` — **inclusive**, matching what the PDF transport sends. */
  readPdfRange(uid: string, begin: number, end: number): Promise<Buffer>
  getToc(uid: string): Promise<BookToc | null>
  open(dir: string): Promise<OpenBookOutcome>
  /**
   * Points an existing book at the folder it lives in now.
   *
   * This is the whole of "the folder was moved": Obsidian's answer for a vault moved
   * outside the app is to open that folder as a vault again, and to offer no separate
   * repair dialog — so this is what the "Locate…" button does, with one addition that
   * matters: the folder has to say it is **this** book (`.lbook/meta.json` carries the
   * uid), and a folder that says otherwise is refused. Without that check, picking the
   * wrong folder would silently swap one book for another.
   */
  relocate(uid: string, dir: string): Promise<WriteOutcome<PdfDocument>>
  /**
   * Registers a folder the app has just created, or brought into the `.lbook` layout.
   *
   * Separate from `open` because `open` asks the user for a folder and this one is
   * handed one by the write side (see `library/create.ts`); both end in the same
   * ledger write and watcher update.
   */
  register(dir: string, uid: string): Promise<PdfDocument>
  remove(uid: string): boolean
  /**
   * A book's file by role, or null when that file is not there.
   *
   * Roles rather than names: the OCR file is whatever `meta.json` says, the cover is
   * whichever of the five names exists, and the renderer should never have to know
   * either (it asks to open "the OCR file").
   */
  resolveFile(uid: string, kind: BookFileKind): Promise<string | null>
  /**
   * Fires when a file inside one of the registered book folders changed.
   *
   * This is for the interface to react to; nothing here depends on it, because every
   * read re-checks the files it parsed itself (see `OpenBook.isStale`).
   */
  onBookChanged(listener: (change: BookChange) => void): void
  /**
   * Drops the cached books, so the next read parses the files again.
   *
   * Called when the window regains focus: on a network share or a removable drive a
   * watch may never fire, and a reader should not have to restart the app to see an
   * edit (T1 in `02-phase2-reactivity-validation.md`).
   */
  refresh(): void
  readonly progress: {
    get(uid: string): ReadingProgress | null
    save(uid: string, pageNum: number): Promise<ReadingProgress>
  }
  dispose(): void
}

/**
 * Messages this module writes itself, as translation keys.
 *
 * `bookGone` is shared with the editors: "this book is no longer in the library" has one
 * meaning wherever it is said. The rest are this feature's.
 */
const MSG = {
  bookGone: "message.edit.bookGone",
  folderGone: "message.relocate.folderGone",
  notAFolder: "message.relocate.notAFolder",
  notABook: "message.relocate.notABook",
  badMeta: "message.relocate.badMeta",
  otherBook: "message.relocate.otherBook",
  missingOcr: "message.relocate.missingOcr",
} as const


export interface LibraryInput {
  ledger: LedgerStore
  progress: ProgressStore
  /** Optional: without it an edit is still picked up, just not announced. */
  watcher?: LibraryWatcher
  /** Injected for deterministic tests. */
  now?: () => string
}

export function createLibrary(input: LibraryInput): Library {
  const { ledger, progress, watcher } = input
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
    // `isStale()` re-stats meta.json and ocr.json: two syscalls (about 20µs) against a
    // page read measured at 0.05–0.3ms, and it is what lets a reader edit a file in
    // their own editor and simply turn back to the app (B10).
    if (cached && cached.dir === dir && !cached.isStale()) return cached

    const book = await openBook(dir)
    books.set(uid, book)
    return book
  }

  /** Keeps the watcher pointed at exactly the registered folders. */
  function syncWatchers(): void {
    watcher?.sync(ledger.list().map((ref) => ({ uid: ref.uid, dir: ledger.resolve(ref) })))
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
      throw new Error(`${meta.ocrFile} is missing from ${LBOOK_DIR}/`)
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
   * Brings a folder into the one layout this build reads: `.lbook/` next to the PDF.
   *
   * Three cases, in order:
   *
   * 1. `dir/.lbook/meta.json` exists — it is already a book, taken as-is.
   * 2. Loose metadata (`meta.json`, `ocr.json`, `toc.json`, a cover) sits next to
   *    `book.pdf`: those files are **moved** into a new `.lbook/`, and a `meta.json`
   *    is written if the loose one is missing. This is the "point at a folder somebody
   *    handed me" path, and it is also how a folder from before the `.lbook` layout
   *    becomes a book again — the app does not read the old layout, it converts it.
   * 3. Neither: refused, with what is missing.
   *
   * An identity found in a loose `meta.json` is kept, so a reader's place in a book
   * survives being re-added. Everything else is derived (name from the folder, page
   * count from the OCR file).
   */
  async function adopt(dir: string): Promise<{ uid: string; adopted: boolean; moved: string[] }> {
    const dataDir = dataDirOf(dir)
    const metaPath = path.join(dataDir, BOOK_FILES.meta)

    if (fs.existsSync(metaPath)) {
      const parsed = parseBookMeta(JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown)
      if (!parsed.ok) throw new Error(`${LBOOK_DIR}/${BOOK_FILES.meta}: ${parsed.error}`)
      return { uid: parsed.meta.uid, adopted: false, moved: [] }
    }

    const pdfPath = path.join(dir, BOOK_FILES.pdf)
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`this folder has no book.pdf and no ${LBOOK_DIR}/ folder, so it is not a book`)
    }

    const loose = fs.readdirSync(dir, { withFileTypes: true })
    const looseJson = loose
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name)
    const ocrFile = looseJson.includes("ocr.json")
      ? "ocr.json"
      : looseJson.find((name) => name !== BOOK_FILES.meta && name !== BOOK_FILES.toc)

    if (!ocrFile) {
      throw new Error(
        `this folder has no ${LBOOK_DIR}/ folder and no OCR JSON next to book.pdf, so it is not a book yet`,
      )
    }

    // The page count is the length of the OCR array, which takes one streaming scan
    // of the file. It is the number reading progress is checked against, so it is
    // worth the ~30ms once, at the moment the user adds the book.
    const scanned = await scanPageSpans(path.join(dir, ocrFile))
    if (scanned.spans.length === 0) {
      throw new Error(`${ocrFile} has no pages: it does not look like PaddleOCR output`)
    }

    // What the folder already says about itself, if anything: a `meta.json` from the
    // old layout is worth reading for its uid, so progress stays attached.
    const inherited = readLooseMeta(dir)

    const uid = inherited?.uid ?? randomUUID().replace(/-/g, "")
    const title = inherited?.title || path.basename(dir)

    fs.mkdirSync(dataDir, { recursive: true })
    const moved: string[] = []
    for (const name of [...looseJson, ...COVER_NAMES]) {
      const from = path.join(dir, name)
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue
      fs.renameSync(from, path.join(dataDir, name))
      moved.push(name)
    }

    fs.writeFileSync(
      metaPath,
      writeBookMeta({
        formatVersion: BOOK_FORMAT_VERSION,
        uid,
        title,
        ...(inherited?.author ? { author: inherited.author } : {}),
        pageCount: scanned.spans.length,
        ocrFile,
        createdAt: inherited?.createdAt ?? now(),
        source: `adopted folder (${ocrFile})`,
      }),
      "utf8",
    )
    return { uid, adopted: true, moved }
  }

  /** A loose `meta.json` next to the PDF, read for its identity only. */
  function readLooseMeta(dir: string): BookMeta | null {
    try {
      const parsed = parseBookMeta(
        JSON.parse(fs.readFileSync(path.join(dir, BOOK_FILES.meta), "utf8")) as unknown,
      )
      return parsed.ok ? parsed.meta : null
    } catch {
      return null
    }
  }

  syncWatchers()

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

    async pageRange(uid, pageNum) {
      const book = await bookFor(uid)
      return book.pageRange(pageNum)
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

        const { uid, adopted, moved } = await adopt(target)
        const { outcome } = ledger.add(target, uid)
        // A folder that moved is still the same book: the entry follows it (see `add`).
        // The cached book has to go, because it holds the directory it was opened from.
        if (outcome === "repointed") books.delete(uid)
        const doc = await describe(uid, target)
        syncWatchers()
        return {
          ok: true,
          doc,
          alreadyKnown: outcome !== "added",
          repointed: outcome === "repointed",
          adopted,
          moved,
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    async register(dir, uid) {
      ledger.add(dir, uid)
      syncWatchers()
      // A fresh folder cannot be in the cache, but a book whose files were just
      // replaced can: dropping the entry is what makes the next read parse them again.
      books.delete(uid)
      return describe(uid, dir)
    },

    async relocate(uid, dir) {
      const known = ledger.list().some((ref) => ref.uid === uid)
      if (!known) {
        return { ok: false, error: "this book is no longer in the library", code: MSG.bookGone }
      }

      const target = path.resolve(dir)
      if (!fs.existsSync(target)) {
        return { ok: false, error: "that folder does not exist", code: MSG.folderGone }
      }
      if (!fs.statSync(target).isDirectory()) {
        return { ok: false, error: "that is a file, not a folder", code: MSG.notAFolder }
      }

      const metaPath = path.join(dataDirOf(target), BOOK_FILES.meta)
      if (!fs.existsSync(metaPath)) {
        return {
          ok: false,
          error: `that folder has no ${LBOOK_DIR}/${BOOK_FILES.meta}, so it is not a book folder`,
          code: MSG.notABook,
        }
      }

      const parsed = parseBookMeta(JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown)
      if (!parsed.ok) {
        return { ok: false, error: `${LBOOK_DIR}/${BOOK_FILES.meta}: ${parsed.error}`, code: MSG.badMeta }
      }
      if (parsed.meta.uid !== uid) {
        return {
          ok: false,
          error: `that folder holds a different book (${parsed.meta.title})`,
          code: MSG.otherBook,
          detail: parsed.meta.title,
        }
      }

      // The file `meta.json` names has to be there, because that is how a folder ends up
      // "the right book but not usable": half-copied, or moved without its `.lbook/`.
      const ocrPath = path.join(dataDirOf(target), parsed.meta.ocrFile)
      if (!fs.existsSync(ocrPath)) {
        return {
          ok: false,
          error: `${parsed.meta.ocrFile} is missing from ${LBOOK_DIR}/`,
          code: MSG.missingOcr,
          detail: parsed.meta.ocrFile,
        }
      }

      // **Read the folder before writing anything.** The ledger is the app's only piece of
      // state, and pointing it at a folder that cannot be opened is worse than the broken
      // path it replaces. (This order was wrong at first, and running the check against the
      // real library showed it: the ledger had been rewritten, and the read-back then
      // failed — leaving the book pointing somewhere unreadable.)
      let book: OpenBook
      try {
        book = await openBook(target)
      } catch (error) {
        // Not one of the cases above, so it is the folder itself: report it as it came.
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }

      ledger.add(target, uid)
      // `openBook` did the work already, so the cache gets it instead of re-reading — and
      // the entry that was cached before holds the *old* directory.
      books.set(uid, book)
      syncWatchers()
      return { ok: true, value: await describe(uid, target) }
    },

    async resolveFile(uid, kind) {
      const book = await bookFor(uid)
      if (kind === "folder") return book.dir
      if (kind === "ocr") return fs.existsSync(book.ocrPath) ? book.ocrPath : null
      if (kind === "pdf") return fs.existsSync(book.pdfPath) ? book.pdfPath : null
      if (kind === "cover") return coverPath(book.dir)

      const file = path.join(book.dataDir, kind === "meta" ? BOOK_FILES.meta : BOOK_FILES.toc)
      return fs.existsSync(file) ? file : null
    },

    remove(uid) {
      const ref = ledger.list().find((item) => item.uid === uid)
      if (!ref) return false
      books.delete(uid)
      const removed = ledger.remove(ref)
      if (removed) {
        progress.keep(new Set(ledger.list().map((item) => item.uid)))
        syncWatchers()
      }
      return removed
    },

    onBookChanged(listener) {
      watcher?.onChange(listener)
    },

    refresh() {
      // Nothing else to do: the next read re-parses whatever is on disk, and
      // `isStale()` is checked on every call anyway.
      books.clear()
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
      watcher?.dispose()
    },
  }
}
