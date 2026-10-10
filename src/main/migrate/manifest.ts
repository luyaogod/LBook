/**
 * The old .lbook manifest, as it was written.
 *
 * Kept only so the one-time converter can read the packages it has to translate;
 * nothing in the running app reads a .lbook any more. See the README next to this
 * file.
 */
export interface BookCoverRef {
  name: string
  mime: string
}

export interface BookManifest {
  format: "lbook"
  formatVersion: number
  uid: string
  title: string
  author: string | null
  createdAt: string
  pageCount: number
  pdfSize: number
  pdfSha256: string
  hasOcr: boolean
  cover: BookCoverRef | null
  generator: string
}

export const LBOOK_FORMAT = "lbook"
export const LBOOK_FORMAT_VERSION = 1
export const LBOOK_EXTENSION = ".lbook"

export const ENTRY_MANIFEST = "manifest.json"
export const ENTRY_PDF = "book.pdf"
export const ENTRY_OCR = "ocr.json"
/**
 * Optional table of contents. It is an entry rather than a database table so it
 * travels with the book: copying the .lbook to another machine must not lose the
 * outline, exactly like the OCR payload it sits next to.
 */
export const ENTRY_TOC = "toc.json"
export const ASSET_PREFIX = "assets/"

export function isManifest(value: unknown): value is BookManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    record.format === LBOOK_FORMAT &&
    typeof record.uid === "string" &&
    record.uid.length > 0 &&
    typeof record.formatVersion === "number"
  )
}

function parseCover(value: unknown): BookCoverRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.name !== "string" || record.name === "") return null
  return { name: record.name, mime: typeof record.mime === "string" ? record.mime : "image/jpeg" }
}

/** Parses and normalizes a manifest, tolerating missing optional fields. */
export function parseManifest(text: string): BookManifest {
  const raw: unknown = JSON.parse(text)
  if (!isManifest(raw)) {
    throw new Error("manifest.json is not an LBook manifest")
  }

  const record = raw as unknown as Record<string, unknown>
  return {
    format: LBOOK_FORMAT,
    formatVersion: record.formatVersion as number,
    uid: record.uid as string,
    title: typeof record.title === "string" && record.title !== "" ? record.title : "Untitled",
    author: typeof record.author === "string" && record.author !== "" ? record.author : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    pageCount: typeof record.pageCount === "number" ? record.pageCount : 0,
    pdfSize: typeof record.pdfSize === "number" ? record.pdfSize : 0,
    pdfSha256: typeof record.pdfSha256 === "string" ? record.pdfSha256 : "",
    hasOcr: record.hasOcr === true,
    cover: parseCover(record.cover),
    generator: typeof record.generator === "string" ? record.generator : "LBook",
  }
}

export function createManifest(fields: {
  uid: string
  title: string
  author: string | null
  createdAt: string
  pageCount: number
  pdfSize: number
  pdfSha256: string
  hasOcr: boolean
  cover: BookCoverRef | null
  generator?: string
}): BookManifest {
  return {
    format: LBOOK_FORMAT,
    formatVersion: LBOOK_FORMAT_VERSION,
    generator: "LBook",
    ...fields,
  }
}

/** Filesystem-safe stem derived from a book title. */
export function slugify(title: string, fallback = "book"): string {
  const slug = title
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    // Strip separators left dangling by the substitutions or the slice, so a
    // title made only of punctuation falls back instead of becoming "-".
    .replace(/^[-\s]+|[-\s]+$/g, "")

  return slug === "" ? fallback : slug
}

/** Package filename for a book: "<title slug>-<uid8>.lbook". */
export function packageFileName(title: string, uid: string): string {
  return `${slugify(title)}-${uid.slice(0, 8)}${LBOOK_EXTENSION}`
}
