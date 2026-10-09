import type { BookManifest, BookToc } from "../../shared/types"
import { parseToc } from "../../shared/toc"
import { closeArchive, getArchive } from "./archiveCache"
import { ENTRY_MANIFEST, ENTRY_OCR, ENTRY_PDF, ENTRY_TOC, parseManifest } from "./manifest"
import type { ZipEntryInfo } from "./zipIndex"

/**
 * Read-only access to a .lbook package.
 *
 * Everything here goes through the shared archive cache, so repeatedly reading
 * pages and covers out of one book costs a single central-directory scan.
 */

export async function listEntries(filePath: string): Promise<ZipEntryInfo[]> {
  return (await getArchive(filePath)).listEntries()
}

export async function readManifest(filePath: string): Promise<BookManifest> {
  return parseManifest(await (await getArchive(filePath)).readText(ENTRY_MANIFEST))
}

/** Uncompressed size of book.pdf — the exact `length` pdf.js's transport needs. */
export async function pdfSize(filePath: string): Promise<number> {
  const entry = (await getArchive(filePath)).getEntry(ENTRY_PDF)
  if (!entry) throw new Error(`Package has no ${ENTRY_PDF}: ${filePath}`)
  return entry.uncompressedSize
}

/**
 * Byte offset of book.pdf inside the package.
 *
 * Needed to copy the PDF verbatim when rewriting a package, so saving never
 * re-reads or re-compresses the book itself.
 */
export async function pdfDataStart(filePath: string): Promise<number> {
  return (await getArchive(filePath)).dataStartOf(ENTRY_PDF)
}

/**
 * Reads `[begin, end]` inclusive of the book's PDF bytes.
 *
 * This is the hot path behind PDF rendering: pdf.js requests ~64 KB chunks and
 * they are served straight from the stored entry, with no inflation or copy.
 */
export async function readPdfRange(filePath: string, begin: number, end: number): Promise<Buffer> {
  return (await getArchive(filePath)).readRange(ENTRY_PDF, begin, end)
}

/** Raw PaddleOCR payload, or null when the package carries none. */
export async function readOcrJson(filePath: string): Promise<unknown | null> {
  const archive = await getArchive(filePath)
  if (!archive.has(ENTRY_OCR)) return null
  return JSON.parse(await archive.readText(ENTRY_OCR))
}

/** Any entry read as UTF-8 text, or null when the package does not carry it. */
export async function readEntryText(filePath: string, entryName: string): Promise<string | null> {
  const archive = await getArchive(filePath)
  if (!archive.has(entryName)) return null
  return archive.readText(entryName)
}

/**
 * The OCR payload exactly as it sits in the package.
 *
 * Repacking rebuilds the whole archive, so every entry that is not re-added is
 * lost; the save path reads this back to hand it over untouched. Passing the raw
 * text rather than the parsed tree keeps an unedited `ocr.json` byte-identical.
 */
export async function readOcrText(filePath: string): Promise<string | null> {
  return readEntryText(filePath, ENTRY_OCR)
}

/** Raw toc.json text, for the same read-back-and-rewrite reason as the OCR text. */
export async function readTocText(filePath: string): Promise<string | null> {
  return readEntryText(filePath, ENTRY_TOC)
}

/**
 * The parsed table of contents, or null when the book has none.
 *
 * A malformed `toc.json` throws rather than degrading to "no contents": silently
 * showing an empty tree for a file the user just hand-edited hides the typo.
 */
export async function readToc(filePath: string): Promise<BookToc | null> {
  const text = await readTocText(filePath)
  if (text === null) return null
  try {
    return parseToc(JSON.parse(text))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${ENTRY_TOC} is invalid: ${detail}`)
  }
}

/** Cover bytes plus MIME type, or null when the package has no cover. */
export async function readCover(
  filePath: string,
  manifest: BookManifest,
): Promise<{ data: Buffer; mime: string } | null> {
  if (!manifest.cover) return null
  const archive = await getArchive(filePath)
  if (!archive.has(manifest.cover.name)) return null
  return { data: await archive.readEntry(manifest.cover.name), mime: manifest.cover.mime }
}

/** Reads an arbitrary entry, used by the lbook:// asset protocol. */
export async function readEntry(filePath: string, entryName: string): Promise<Buffer> {
  const archive = await getArchive(filePath)
  if (!archive.has(entryName)) throw new Error(`Entry not found: ${entryName}`)
  return archive.readEntry(entryName)
}

export async function hasEntry(filePath: string, entryName: string): Promise<boolean> {
  return (await getArchive(filePath)).has(entryName)
}

/**
 * Releases the cached handle. MUST be awaited before replacing a package on
 * disk — Windows will not rename over a file that is still open.
 */
export function closeBook(filePath: string): Promise<void> {
  return closeArchive(filePath)
}
