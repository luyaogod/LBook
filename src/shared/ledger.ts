/**
 * The library ledger: which folders are books.
 *
 * This is Obsidian's vault list, not a folder to scan. A book may live anywhere
 * — another drive, a network share, next to the user's own notes — so the app
 * keeps a list of paths instead of looking for books in one place. `remove()`
 * therefore only forgets an entry: the application never deletes a book folder
 * (A11 in `.agents/plan/00-decisions.md`).
 *
 * Zero dependencies and no I/O: the file lives in the main process, this is only
 * the shape and its validation, so a hand-edited ledger degrades to "these
 * entries are fine, those two are not" instead of breaking the library.
 */

export const LEDGER_VERSION = 1

export interface BookRef {
  /**
   * Relative to the default new-book location when the folder is inside it (so
   * moving that whole folder keeps working), absolute otherwise.
   */
  path: string
  /** Mirrors `meta.json.uid`, so a moved book can be recognised later. */
  uid: string
  addedAt: string
}

export interface Ledger {
  version: number
  books: BookRef[]
}

export function emptyLedger(): Ledger {
  return { version: LEDGER_VERSION, books: [] }
}

/**
 * Reads the ledger.
 *
 * A missing/short/odd file yields the entries that do parse plus a list of
 * human-readable issues; it never throws, because losing the library over one
 * bad line in a JSON file is not acceptable.
 */
export function parseLedger(raw: unknown): { ledger: Ledger; issues: string[] } {
  const issues: string[] = []
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ledger: emptyLedger(), issues: ["library.json is not a JSON object"] }
  }

  const record = raw as Record<string, unknown>
  const version = typeof record.version === "number" ? record.version : LEDGER_VERSION
  if (version > LEDGER_VERSION) {
    issues.push(`library.json says version ${version}, which is newer than this build understands`)
  }

  const books: BookRef[] = []
  const seen = new Set<string>()
  const rawBooks = record.books
  if (rawBooks !== undefined && !Array.isArray(rawBooks)) {
    issues.push("library.json has no books array")
  }
  for (const [index, entry] of (Array.isArray(rawBooks) ? rawBooks : []).entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(`books[${index}] is not an object`)
      continue
    }
    const item = entry as Record<string, unknown>
    const path = text(item.path)
    const uid = text(item.uid)
    if (path === null || uid === null) {
      issues.push(`books[${index}] is missing path or uid`)
      continue
    }
    // Two entries for the same folder would show up twice in the library; keep
    // the first and say so rather than quietly listing a duplicate.
    const key = `${path}\u0000${uid}`
    if (seen.has(key)) {
      issues.push(`books[${index}] repeats an earlier entry`)
      continue
    }
    seen.add(key)
    books.push({ path, uid, addedAt: text(item.addedAt) ?? "" })
  }

  return { ledger: { version: LEDGER_VERSION, books }, issues }
}

/** Serialises the ledger: stable key order, two-space indent, trailing newline (B5). */
export function serializeLedger(ledger: Ledger): string {
  const books = ledger.books.map((book) => ({ path: book.path, uid: book.uid, addedAt: book.addedAt }))
  return `${JSON.stringify({ version: LEDGER_VERSION, books }, null, 2)}\n`
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
