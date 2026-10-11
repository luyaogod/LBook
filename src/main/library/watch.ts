import fs from "node:fs"
import { BOOK_FILES } from "../../shared/bookFile"
import { fingerprintOf, dataDirOf, sameFingerprint, type FileFingerprint } from "./book"

/**
 * Watching the book folders a reader is working in.
 *
 * This is **not** the mechanism that makes an edit visible — `OpenBook.isStale()`
 * is, by re-statting the two files it parsed before every call. This module exists
 * so the *interface* can catch up without the reader switching windows, and it is
 * built as one accelerator with two fallbacks underneath it, because `fs.watch` on
 * Windows is not something to depend on:
 *
 *   1. `fs.watch` on each book folder **and on its `.lbook` directory** (two
 *      watchers, because a watch does not see into subdirectories: the PDF and the
 *      cover live at different levels, and the ocr.json that matters most lives in
 *      the metadata directory);
 *   2. the window-focus rescan the main process triggers (see `index.ts`);
 *   3. a 30-second poll, started **only** for folders whose watch failed to attach
 *      (a network share, a mapped drive, a folder that vanished mid-session).
 *
 * The module is deliberately free of Electron: it reports changes, the caller
 * decides who to tell.
 */

/** How long to wait for the dust to settle. Editors write in several steps. */
const DEBOUNCE_MS = 300

/** Only used for folders whose watch could not be attached. */
const POLL_MS = 30_000

export interface BookChange {
  uid: string
  dir: string
  /** Which of the files this module tracks differ from what was recorded. */
  changed: Array<"meta.json" | "ocr.json" | "other">
}

export interface LibraryWatcher {
  /** Replaces the set of watched folders. Called whenever the ledger changes. */
  sync(books: Array<{ uid: string; dir: string }>): void
  /** Reports a change to one folder. */
  onChange(listener: (change: BookChange) => void): void
  /**
   * True when at least one folder is on the fallback poll instead of a real watch
   * (the interface says so rather than pretending a refresh happened).
   */
  readonly degraded: boolean
  /** Folders currently on the fallback poll, for a log line or a test. */
  unwatched(): string[]
  dispose(): void
}

interface WatchedBook {
  uid: string
  dir: string
  /** One per level: the book folder, and its `.lbook` directory. */
  watchers: fs.FSWatcher[]
  /** Fingerprints as of the last report, so a poll can tell "changed" from "same". */
  fingerprints: Record<string, FileFingerprint | null>
}

export interface LibraryWatcherInput {
  /** Injected so a test does not have to wait 300ms for every case. */
  debounceMs?: number
  pollMs?: number
  onWarn?: (message: string) => void
}

export function createLibraryWatcher(input: LibraryWatcherInput = {}): LibraryWatcher {
  const debounceMs = input.debounceMs ?? DEBOUNCE_MS
  const pollMs = input.pollMs ?? POLL_MS
  const warn = input.onWarn ?? ((message: string) => console.warn(message))

  let books: WatchedBook[] = []
  let pollTimer: ReturnType<typeof setInterval> | null = null
  const listeners: Array<(change: BookChange) => void> = []
  /** uid → timer, so one book's burst of writes is reported once. */
  const pending = new Map<string, ReturnType<typeof setTimeout>>()

  const notify = (change: BookChange): void => {
    for (const listener of listeners) listener(change)
  }

  /** The two files whose edits the interface can act on, in the metadata folder. */
  const trackedPaths = (dir: string): Record<string, string> => {
    const dataDir = dataDirOf(dir)
    return {
      "meta.json": `${dataDir}/${BOOK_FILES.meta}`,
      "ocr.json": `${dataDir}/ocr.json`,
    }
  }

  function tracksOf(book: WatchedBook): void {
    const paths = trackedPaths(book.dir)
    book.fingerprints = {
      "meta.json": fingerprintOf(paths["meta.json"]),
      "ocr.json": fingerprintOf(paths["ocr.json"]),
      other: null,
    }
  }

  /** Which files differ from the recorded state; empty means "nothing we watch". */
  function differences(book: WatchedBook): Array<"meta.json" | "ocr.json" | "other"> {
    const paths = trackedPaths(book.dir)
    const changed: Array<"meta.json" | "ocr.json" | "other"> = []
    for (const name of ["meta.json", "ocr.json"] as const) {
      if (!sameFingerprint(book.fingerprints[name] ?? null, fingerprintOf(paths[name]))) {
        changed.push(name)
      }
    }
    return changed
  }

  function schedule(book: WatchedBook): void {
    const existing = pending.get(book.uid)
    if (existing) clearTimeout(existing)

    pending.set(
      book.uid,
      setTimeout(() => {
        pending.delete(book.uid)
        const changed = differences(book)
        // A watched folder whose files we do *not* track (the PDF, a cover, anything
        // else) still means "something here changed", which is worth telling the
        // interface about — it may be the cover it renders.
        if (changed.length === 0) changed.push("other")
        tracksOf(book)
        notify({ uid: book.uid, dir: book.dir, changed })
      }, debounceMs),
    )
  }

  /** Attaches one watch, or reports that this level could not be watched. */
  function watchLevel(book: WatchedBook, target: string): boolean {
    try {
      const watcher = fs.watch(target, { persistent: false }, () => schedule(book))
      watcher.on("error", (error) => {
        // A watch that dies mid-session (the folder moved to a drive that fell off)
        // falls back to the poll rather than reporting nothing.
        warn(`[watch] stopped watching ${target}: ${error.message}`)
        watcher.close()
        book.watchers = book.watchers.filter((item) => item !== watcher)
        startPolling()
      })
      book.watchers.push(watcher)
      return true
    } catch (error) {
      warn(`[watch] cannot watch ${target}: ${(error as Error).message}`)
      return false
    }
  }

  function startPolling(): void {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      for (const book of books) {
        if (book.watchers.length > 0) continue // a real watch is already reporting this one
        const changed = differences(book)
        if (changed.length === 0) continue
        tracksOf(book)
        notify({ uid: book.uid, dir: book.dir, changed })
      }
    }, pollMs)
    // A timer must not keep the process alive on its own.
    pollTimer.unref?.()
  }

  const unwatched = (): string[] => books.filter((book) => book.watchers.length === 0).map((book) => book.dir)

  function closeAll(book: WatchedBook): void {
    for (const watcher of book.watchers) watcher.close()
    book.watchers = []
    const timer = pending.get(book.uid)
    if (timer) clearTimeout(timer)
    pending.delete(book.uid)
  }

  return {
    get degraded() {
      return unwatched().length > 0
    },

    unwatched,

    onChange(listener) {
      listeners.push(listener)
    },

    sync(next) {
      // Close what is gone; keep what is still there, so an unchanged book does not
      // lose its watchers on every ledger write.
      const wanted = new Map(next.map((book) => [book.uid, book.dir]))
      for (const book of books) {
        if (wanted.get(book.uid) === book.dir) continue
        closeAll(book)
      }

      const kept = new Map(
        books.filter((book) => wanted.get(book.uid) === book.dir).map((book) => [book.uid, book] as const),
      )

      books = next.map(({ uid, dir }) => {
        const existing = kept.get(uid)
        if (existing) return existing

        const book: WatchedBook = { uid, dir, watchers: [], fingerprints: {} }
        tracksOf(book)

        // A watch does not look into subdirectories, and the metadata the interface
        // cares about lives one level down: `book.pdf` and the `.lbook` folder itself
        // are the root's business, everything else is the directory's.
        const rootOk = watchLevel(book, dir)
        const dataOk = fs.existsSync(dataDirOf(dir)) ? watchLevel(book, dataDirOf(dir)) : false
        if (!rootOk && !dataOk) startPolling()
        return book
      })

      if (unwatched().length > 0) startPolling()
      if (pollTimer && unwatched().length === 0) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    },

    dispose() {
      for (const book of books) closeAll(book)
      books = []
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}

