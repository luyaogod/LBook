import fs from "node:fs"
import { fingerprintOf, sameFingerprint, type FileFingerprint } from "./book"

/**
 * Watching the book folders a reader is working in.
 *
 * This is **not** the mechanism that makes an edit visible — `OpenBook.isStale()`
 * is, by re-statting the two files it parsed before every call. This module exists
 * so the *interface* can catch up without the reader switching windows, and it is
 * built as one accelerator with two fallbacks underneath it, because `fs.watch` on
 * Windows is not something to depend on:
 *
 *   1. `fs.watch` per book folder, debounced;
 *   2. the window-focus rescan the main process triggers (see `index.ts`);
 *   3. a 30-second poll, started **only** for folders whose watch failed to attach
 *      (a network share, a mapped drive, a folder that vanished mid-session).
 *
 * What a folder being "watched" means: a file *in that folder*. Subfolders are not
 * watched — the recursive flag is not supported everywhere — and a change down there
 * is what the poll and the focus rescan are for.
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
  /** Which of the two files this module tracks differ from what was recorded. */
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
  watcher: fs.FSWatcher | null
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

  function tracksOf(book: WatchedBook): void {
    book.fingerprints = {
      "meta.json": fingerprintOf(`${book.dir}/meta.json`),
      "ocr.json": fingerprintOf(`${book.dir}/ocr.json`),
      other: null,
    }
  }

  /** Which files differ from the recorded state; empty means "nothing we watch". */
  function differences(book: WatchedBook): Array<"meta.json" | "ocr.json" | "other"> {
    const changed: Array<"meta.json" | "ocr.json" | "other"> = []
    for (const name of ["meta.json", "ocr.json"] as const) {
      if (!sameFingerprint(book.fingerprints[name] ?? null, fingerprintOf(`${book.dir}/${name}`))) {
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
        // A watched folder whose files we do *not* track (the PDF, a cover, a
        // subfolder) still means "something here changed", which is worth telling
        // the interface about — it may be the cover it renders.
        if (changed.length === 0) changed.push("other")
        tracksOf(book)
        notify({ uid: book.uid, dir: book.dir, changed })
      }, debounceMs),
    )
  }

  function startPolling(): void {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      for (const book of books) {
        if (book.watcher) continue // a real watch is already reporting this one
        const changed = differences(book)
        if (changed.length === 0) continue
        tracksOf(book)
        notify({ uid: book.uid, dir: book.dir, changed })
      }
    }, pollMs)
    // A timer must not keep the process alive on its own.
    pollTimer.unref?.()
  }

  return {
    get degraded() {
      return books.some((book) => book.watcher === null)
    },

    unwatched: () => books.filter((book) => book.watcher === null).map((book) => book.dir),

    onChange(listener) {
      listeners.push(listener)
    },

    sync(next) {
      // Close what is gone; keep what is still there, so an unchanged book does not
      // lose its watcher on every ledger write.
      const wanted = new Map(next.map((book) => [book.uid, book.dir]))
      for (const book of books) {
        if (wanted.get(book.uid) === book.dir) continue
        book.watcher?.close()
        const timer = pending.get(book.uid)
        if (timer) clearTimeout(timer)
        pending.delete(book.uid)
      }

      const kept = new Map(
        books
          .filter((book) => wanted.get(book.uid) === book.dir)
          .map((book) => [book.uid, book] as const),
      )

      books = next.map(({ uid, dir }) => {
        const existing = kept.get(uid)
        if (existing) return existing

        const book: WatchedBook = { uid, dir, watcher: null, fingerprints: {} }
        tracksOf(book)
        try {
          const watcher = fs.watch(dir, { persistent: false }, () => schedule(book))
          watcher.on("error", (error) => {
            // A watch that dies mid-session (the folder was moved to a drive that
            // fell off) falls back to the poll rather than reporting nothing.
            warn(`[watch] stopped watching ${dir}: ${error.message}`)
            watcher.close()
            book.watcher = null
            startPolling()
          })
          book.watcher = watcher
        } catch (error) {
          warn(`[watch] cannot watch ${dir}: ${(error as Error).message}`)
        }
        return book
      })

      if (books.some((book) => book.watcher === null)) startPolling()
      if (pollTimer && !books.some((book) => book.watcher === null)) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    },

    dispose() {
      for (const book of books) book.watcher?.close()
      books = []
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}
