import fs from "node:fs"
import path from "node:path"
import { emptyLedger, parseLedger, serializeLedger, type BookRef } from "../../shared/ledger"

/**
 * The ledger's file half.
 *
 * `root` is the default new-book location (B7): a folder inside it is recorded
 * as a relative path, so moving the whole library elsewhere keeps working; a
 * folder anywhere else is recorded absolute. In both cases `resolve()` gives the
 * directory back.
 *
 * Every mutation writes the file atomically (temp + rename), the same way
 * `config.ts` does — a half-written ledger would cost the user their library
 * list, and that list is the only thing the app owns.
 */
export interface LedgerStore {
  /** Parse problems from the last load, for the UI to show. */
  readonly issues: string[]
  list(): BookRef[]
  /** Absolute directory of an entry. */
  resolve(ref: BookRef): string
  /**
   * Registers a folder, or re-points an existing entry at it.
   *
   * A book's identity is the uid inside its own `.lbook/` — the same relationship Obsidian
   * has between a vault and the `.obsidian` folder it carries — so the entry follows the
   * folder when it moves instead of a second row appearing for the same book.
   */
  add(dir: string, uid: string): { ref: BookRef; outcome: LedgerAddOutcome }
  /**
   * Forgets an entry. **Never touches the disk** — this is the whole promise of
   * A11: "delete" in the library means "stop listing it".
   */
  remove(ref: BookRef): boolean
}

/**
 * What `add` did.
 *
 * `known` — the book is already listed at that exact folder.
 * `repointed` — the book was already listed somewhere else, and now lives here.
 * `added` — a book the ledger had never seen.
 */
export type LedgerAddOutcome = "added" | "known" | "repointed"

export interface LedgerStoreInput {
  /** Path of `library.json`. */
  file: string
  /** Default new-book location; relative entries are resolved against it. */
  root: string
  /** Injected for deterministic tests. */
  now?: () => string
}

export function createLedgerStore(input: LedgerStoreInput): LedgerStore {
  const now = input.now ?? (() => new Date().toISOString())
  let ledger = emptyLedger()
  let issues: string[] = []

  try {
    const parsed = parseLedger(JSON.parse(fs.readFileSync(input.file, "utf8")))
    ledger = parsed.ledger
    issues = parsed.issues
  } catch (error) {
    // A missing file is the normal first-run case; anything else is reported and
    // the library starts empty rather than not starting at all.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      issues = [`library.json could not be read: ${(error as Error).message}`]
    }
  }

  const resolve = (ref: BookRef): string =>
    path.isAbsolute(ref.path) ? path.normalize(ref.path) : path.resolve(input.root, ref.path)

  /** Windows compares paths case-insensitively; keep one spelling of "same". */
  const samePath = (a: string, b: string): boolean =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b

  const persist = (): void => {
    fs.mkdirSync(path.dirname(input.file), { recursive: true })
    const temp = `${input.file}.tmp`
    fs.writeFileSync(temp, serializeLedger(ledger), "utf8")
    fs.renameSync(temp, input.file)
  }

  return {
    get issues() {
      return issues
    },

    list: () => [...ledger.books],
    resolve,

    add(dir, uid) {
      const target = path.resolve(dir)

      /** Inside the default location, store relative so the whole library can move (B7). */
      const storedPath = (): string => {
        const relative = path.relative(path.resolve(input.root), target)
        const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
        return inside ? relative : target
      }

      const replace = (from: BookRef, to: BookRef): { ref: BookRef; outcome: LedgerAddOutcome } => {
        ledger = { ...ledger, books: ledger.books.map((ref) => (ref === from ? to : ref)) }
        persist()
        return { ref: to, outcome: "repointed" }
      }

      const byUid = ledger.books.find((ref) => ref.uid === uid)
      if (byUid !== undefined) {
        if (samePath(resolve(byUid), target)) return { ref: byUid, outcome: "known" }
        // The same book in a different folder: it was moved (or a copy of it is being
        // opened). Obsidian's rule for a vault moved outside the app — open the folder as
        // a vault again and the list entry follows — so the book keeps one row, and
        // `addedAt` stays: it records when the book joined the library, not when it moved.
        return replace(byUid, { ...byUid, path: storedPath() })
      }

      const byPath = ledger.books.find((ref) => samePath(resolve(ref), target))
      if (byPath !== undefined) {
        // The folder is listed but now says it is a different book (its `meta.json` was
        // replaced, or the two books were swapped). The folder wins: the uid is what
        // progress, the cover and every read are keyed by.
        return replace(byPath, { ...byPath, uid })
      }

      const ref: BookRef = { path: storedPath(), uid, addedAt: now() }
      ledger = { ...ledger, books: [...ledger.books, ref] }
      persist()
      return { ref, outcome: "added" }
    },

    remove(ref) {
      const before = ledger.books.length
      // Match on either identity: a hand-edited ledger could spell the same book
      // twice, and "remove this one" should mean the book, not the line.
      ledger = {
        ...ledger,
        books: ledger.books.filter(
          (item) => !(item.uid === ref.uid || samePath(resolve(item), resolve(ref))),
        ),
      }
      if (ledger.books.length === before) return false
      persist()
      return true
    },
  }
}
