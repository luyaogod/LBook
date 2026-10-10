/**
 * The contract for a book folder's `meta.json`.
 *
 * `meta.json` is the only file we add to a book folder, and this is the only
 * module that decides its shape: parsing (used by the library listing, which
 * must never throw on a file the user hand-edited) and writing (used when a book
 * is created and when one is migrated).
 *
 * `ocrFile` is resolved *inside* the book folder and may not escape it. A
 * meta.json pointing at `../../secrets.json` is a path-traversal request, not a
 * book, so it is a hard error. Everything else is allowed to be absent — the
 * caller turns that into a problem *on that book* rather than failing the whole
 * library.
 *
 * Zero dependencies and no I/O: it runs in the renderer's tests as happily as in
 * the main process.
 */

export const BOOK_FORMAT_VERSION = 1

export interface BookMeta {
  /** Bumped when the shape changes in a way older builds cannot read. */
  formatVersion: number
  /** Identity, stable across renames and moves. Keys reading progress. */
  uid: string
  /** Display name. May be empty: the caller falls back to the folder name. */
  title: string
  author?: string
  /** Pages as PaddleOCR reported them; cross-checked against the PDF. */
  pageCount: number
  /** Bare file name of the OCR JSON inside this folder. */
  ocrFile: string
  createdAt?: string
  /** Free-form provenance, e.g. "paddleocr-vl / pp-structurev3". */
  source?: string
}

export type BookMetaResult = { ok: true; meta: BookMeta } | { ok: false; error: string }

/**
 * True when `name` is a plain file name that cannot escape its folder.
 *
 * Deliberately string-only (no `node:path`) so this module stays dependency-free:
 * we reject separators, drive letters, UNC prefixes, `.`/`..` and anything
 * absolute, which is stricter than `path.isAbsolute` on Windows or POSIX.
 */
export function isSafeBookFileName(name: string): boolean {
  if (name === "" || name === "." || name === "..") return false
  if (name.includes("/") || name.includes("\\")) return false
  if (name.includes(":")) return false // C: or a stream name
  if (name.startsWith("\0")) return false
  return true
}

/** Reads `meta.json`. Never throws: a bad file comes back as `{ ok: false }`. */
export function parseBookMeta(raw: unknown): BookMetaResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "meta.json is not a JSON object" }
  }
  const record = raw as Record<string, unknown>

  const formatVersion = typeof record.formatVersion === "number" ? record.formatVersion : 1
  if (formatVersion > BOOK_FORMAT_VERSION) {
    return {
      ok: false,
      error: `meta.json says formatVersion ${formatVersion}, but this build understands ${BOOK_FORMAT_VERSION}`,
    }
  }

  const uid = text(record.uid)
  if (uid === null) return { ok: false, error: "meta.json has no uid" }

  const ocrFile = text(record.ocrFile)
  if (ocrFile === null) return { ok: false, error: "meta.json has no ocrFile" }
  if (!isSafeBookFileName(ocrFile)) {
    return { ok: false, error: `ocrFile must be a file name inside the book folder, got "${ocrFile}"` }
  }

  const pageCount = record.pageCount
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1) {
    return { ok: false, error: `meta.json needs a whole pageCount >= 1, got ${JSON.stringify(pageCount)}` }
  }

  // Everything below is optional, and unknown keys are simply ignored: the app
  // never writes this file back, so a user's extra fields survive on their own.
  return {
    ok: true,
    meta: {
      formatVersion,
      uid,
      title: text(record.title) ?? "",
      author: text(record.author) ?? undefined,
      pageCount,
      ocrFile,
      createdAt: text(record.createdAt) ?? undefined,
      source: text(record.source) ?? undefined,
    },
  }
}

/**
 * Serialises a `meta.json`.
 *
 * Two-space indent, a fixed key order and a trailing newline, always — not for
 * looks: a book folder is meant to be readable and diffable by the user (B5 in
 * `.agents/plan/00-decisions.md`), and a stable order is what keeps a
 * `git status` quiet when nothing meaningful changed.
 */
export function writeBookMeta(meta: BookMeta): string {
  const ordered: Record<string, unknown> = {
    formatVersion: meta.formatVersion,
    uid: meta.uid,
    title: meta.title,
  }
  if (meta.author !== undefined) ordered.author = meta.author
  ordered.pageCount = meta.pageCount
  ordered.ocrFile = meta.ocrFile
  if (meta.createdAt !== undefined) ordered.createdAt = meta.createdAt
  if (meta.source !== undefined) ordered.source = meta.source
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/** Non-empty trimmed string, or null when the value is missing/blank/not a string. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
