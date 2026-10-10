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
  /** Registers a folder. Returns the new entry, or null when it is already known. */
  add(dir: string, uid: string): BookRef | null
  /**
   * Forgets an entry. **Never touches the disk** — this is the whole promise of
   * A11: "delete" in the library means "stop listing it".
   */
  remove(ref: BookRef): boolean
}

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
      const known = ledger.books.some((ref) => ref.uid === uid || samePath(resolve(ref), target))
      if (known) return null

      const relative = path.relative(path.resolve(input.root), target)
      const storeRelative = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
      const ref: BookRef = { path: storeRelative ? relative : target, uid, addedAt: now() }
      ledger = { ...ledger, books: [...ledger.books, ref] }
      persist()
      return ref
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
