import fs from "node:fs"
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
import { parseToc } from "../../shared/toc"
import type { PdfDocument } from "../../shared/types"
import { scanPageSpans } from "../lbook/offsetIndex"
import { dataDirOf } from "./book"
import type { Library } from "./library"

/**
 * The write side: creating a book from files, and replacing a book's files.
 *
 * This is the app's own writing, and it exists for one reason — somebody has to
 * validate a PaddleOCR file and name a folder, and asking a reader to do that by
 * hand is asking them to be a build script (A17).
 *
 * Three rules hold everywhere in here:
 *
 * 1. **Nothing half-made.** A book is built in a hidden staging folder and renamed
 *    into place only once every file is there, so a failure leaves no folder that
 *    looks like a book.
 * 2. **The bytes are the user's.** `ocr.json` is copied, never re-serialized (A7);
 *    `toc.json` likewise. The only file this module *writes* is `meta.json`.
 * 3. **A replacement never destroys the old file before the new one is there.** The
 *    copy lands in a temporary name next to the target and is renamed over it.
 */

export interface BookSources {
  /** The scan. Required. */
  pdfPath: string
  /** PaddleOCR's own JSON. Required. */
  ocrPath: string
  coverPath?: string | null
  tocPath?: string | null
  /** Overrides the title derived from the PDF's file name. */
  title?: string
}

export interface CreateBookInput extends BookSources {
  /** Where the book folder is created. The user picks it in the dialog. */
  destination: string
}

export type CreatePreview =
  | {
      ok: true
      title: string
      /** The folder that would be created, and the name that would be used. */
      dir: string
      folderName: string
      pageCount: number
      ocrBytes: number
      /** Things worth saying before creating, not reasons to refuse. */
      warnings: string[]
    }
  | { ok: false; error: string }

export type WriteOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

/** Filenames the app will never accept as a source: they are its own. */
function checkSourceFile(file: string, what: string): string | null {
  if (!file || !fs.existsSync(file)) return `${what} is not there: ${file}`
  let stats: fs.Stats
  try {
    stats = fs.statSync(file)
  } catch (error) {
    return `${what} cannot be read: ${(error as Error).message}`
  }
  if (!stats.isFile()) return `${what} is not a file: ${file}`
  if (stats.size === 0) return `${what} is empty`
  return null
}

/** A PDF has to at least look like one; pdf.js will be the judge of the rest. */
function checkPdf(file: string): string | null {
  const missing = checkSourceFile(file, "the PDF")
  if (missing) return missing
  const handle = fs.openSync(file, "r")
  try {
    const header = Buffer.alloc(5)
    const read = fs.readSync(handle, header, 0, 5, 0)
    if (read < 5 || header.toString("latin1") !== "%PDF-") {
      return "that file does not start with %PDF-, so it is not a PDF"
    }
  } finally {
    fs.closeSync(handle)
  }
  return null
}

/**
 * The OCR file, checked the way the reader will read it.
 *
 * Streaming scan rather than `JSON.parse`: a 40MB file with no
 * `layoutParsingResults` is refused in milliseconds and without 200MB of heap.
 */
async function checkOcr(file: string): Promise<{ error: string } | { pages: number; bytes: number }> {
  const missing = checkSourceFile(file, "the OCR JSON")
  if (missing) return { error: missing }

  let scanned: Awaited<ReturnType<typeof scanPageSpans>>
  try {
    scanned = await scanPageSpans(file)
  } catch (error) {
    return { error: `the OCR JSON could not be read: ${(error as Error).message}` }
  }
  if (!scanned.foundArray) {
    return { error: "that JSON has no layoutParsingResults array, so it is not PaddleOCR output" }
  }
  if (scanned.spans.length === 0) {
    return { error: "that JSON's layoutParsingResults array is empty, so there are no pages in it" }
  }
  return { pages: scanned.spans.length, bytes: scanned.fileBytes }
}

/** The outline, parsed with the same rules the reader uses. */
function checkToc(file: string): string | null {
  const missing = checkSourceFile(file, "the table of contents")
  if (missing) return missing
  try {
    parseToc(JSON.parse(fs.readFileSync(file, "utf8")) as unknown)
  } catch (error) {
    return `that table of contents is not valid: ${(error as Error).message}`
  }
  return null
}

function checkCover(file: string): string | null {
  const missing = checkSourceFile(file, "the cover")
  if (missing) return missing
  const extension = path.extname(file).toLowerCase()
  if (!COVER_NAMES.some((name) => name.endsWith(extension))) {
    return `a cover has to be an image (${COVER_NAMES.map((name) => path.extname(name)).join(", ")})`
  }
  return null
}

/** A folder name derived from a title, safe on every platform. */
export function slugifyTitle(title: string, fallback = "book"): string {
  const slug = title
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/^[-\s.]+|[-\s.]+$/g, "")
  return slug === "" ? fallback : slug
}

/**
 * The folder to create, given what is already in the destination.
 *
 * Windows compares names case-insensitively and cannot have two folders that differ
 * only in case, so the check here does too — otherwise the rename at the end fails
 * on a machine where `Laws` already exists as `laws`.
 */
function freeFolderName(destination: string, title: string): { name: string; dir: string } {
  const taken = new Set(
    fs.existsSync(destination)
      ? fs.readdirSync(destination).map((name) => name.toLowerCase())
      : [],
  )
  const stem = slugifyTitle(title)
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? stem : `${stem}-${n}`
    if (!taken.has(name.toLowerCase())) return { name, dir: path.join(destination, name) }
  }
  throw new Error(`cannot find a free folder name for "${title}"`)
}

/**
 * Validates a set of source files and works out what would be created.
 *
 * The dialog calls this before offering to create anything, so the name, the page
 * count and any complaints are on screen **before** the reader commits. It writes
 * nothing.
 */
export async function previewBook(input: CreateBookInput): Promise<CreatePreview> {
  try {
    const destination = path.resolve(input.destination)
    if (!input.destination) return { ok: false, error: "no destination folder was chosen" }

    const pdfError = checkPdf(input.pdfPath)
    if (pdfError) return { ok: false, error: pdfError }

    const ocr = await checkOcr(input.ocrPath)
    if ("error" in ocr) return { ok: false, error: ocr.error }

    if (input.tocPath) {
      const tocError = checkToc(input.tocPath)
      if (tocError) return { ok: false, error: tocError }
    }
    if (input.coverPath) {
      const coverError = checkCover(input.coverPath)
      if (coverError) return { ok: false, error: coverError }
    }

    const title = (input.title ?? path.basename(input.pdfPath, path.extname(input.pdfPath))).trim()
    if (title === "") return { ok: false, error: "the book needs a title" }

    const { name, dir } = freeFolderName(destination, title)

    const warnings: string[] = []
    if (!fs.existsSync(destination)) {
      warnings.push(`${destination} does not exist yet; it will be created`)
    }
    if (input.coverPath && input.tocPath === undefined) {
      warnings.push("no table of contents was chosen: the book will have none")
    }

    return {
      ok: true,
      title,
      dir,
      folderName: name,
      pageCount: ocr.pages,
      ocrBytes: ocr.bytes,
      warnings,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Creates a book folder from files the reader picked.
 *
 * `book.pdf` goes at the top of the new folder and everything else into its
 * `.lbook` directory, which is the layout the whole app reads (A16).
 */
export async function createBook(
  input: CreateBookInput,
  library: Library,
): Promise<WriteOutcome<PdfDocument>> {
  const preview = await previewBook(input)
  if (!preview.ok) return { ok: false, error: preview.error }

  const destination = path.resolve(input.destination)
  const uid = randomUUID().replace(/-/g, "")
  // Built under a dot-prefixed, unique name: an interrupted run cannot be mistaken
  // for a finished book, and two runs cannot collide.
  const staging = path.join(destination, `.creating-${uid.slice(0, 8)}`)

  try {
    fs.mkdirSync(path.join(staging, LBOOK_DIR), { recursive: true })

    // copyFile rather than a read/write pair: a 190MB PDF is a kernel-side copy,
    // and the OCR bytes stay exactly as PaddleOCR wrote them (A7).
    fs.copyFileSync(input.pdfPath, path.join(staging, BOOK_FILES.pdf))
    fs.copyFileSync(input.ocrPath, path.join(staging, LBOOK_DIR, "ocr.json"))

    if (input.tocPath) {
      fs.copyFileSync(input.tocPath, path.join(staging, LBOOK_DIR, BOOK_FILES.toc))
    }
    if (input.coverPath) {
      const extension = path.extname(input.coverPath).toLowerCase()
      fs.copyFileSync(input.coverPath, path.join(staging, LBOOK_DIR, `cover${extension}`))
    }

    fs.writeFileSync(
      path.join(staging, LBOOK_DIR, BOOK_FILES.meta),
      writeBookMeta({
        formatVersion: BOOK_FORMAT_VERSION,
        uid,
        title: preview.title,
        pageCount: preview.pageCount,
        ocrFile: "ocr.json",
        createdAt: new Date().toISOString(),
        source: `created from ${path.basename(input.pdfPath)}`,
      }),
      "utf8",
    )

    // Everything is in place: the folder appears under its real name in one step.
    fs.renameSync(staging, preview.dir)
    return { ok: true, value: await library.register(preview.dir, uid) }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** What can be replaced. `title` is the one thing that is not a file. */
export type ReplaceRole = "ocr" | "cover" | "toc" | "pdf" | "title"

/**
 * Copies over a file, keeping the old one until the new one is fully written.
 *
 * The `.incoming` name sits in the target's own directory on purpose: a rename is
 * only atomic within one filesystem, and the file the reader picked may be on
 * another drive entirely.
 */
function replaceAtomically(source: string, target: string): void {
  const temporary = `${target}.incoming`
  try {
    fs.copyFileSync(source, temporary)
    // rename over the target: on Windows libuv uses MOVEFILE_REPLACE_EXISTING, so this
    // works even though a plain `mv` in a shell would refuse.
    fs.renameSync(temporary, target)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

/**
 * Replaces one of a book's files, or renames it.
 *
 * The book must already be in the library. Each role is validated with the same
 * rules used when creating a book, so a replacement cannot introduce something the
 * reader will choke on later.
 */
export async function replaceBookFile(
  library: Library,
  uid: string,
  role: ReplaceRole,
  value: string,
): Promise<WriteOutcome<{ pageCount?: number; title?: string }>> {
  const doc = await library.get(uid)
  if (!doc) return { ok: false, error: "this book is no longer in the library" }

  const dataDir = dataDirOf(doc.dir)
  if (!fs.existsSync(dataDir)) {
    return { ok: false, error: `this book has no ${LBOOK_DIR} folder` }
  }

  try {
    if (role === "title") {
      const title = value.trim()
      if (title === "") return { ok: false, error: "the title cannot be empty" }
      const metaPath = path.join(dataDir, BOOK_FILES.meta)
      const parsed = parseBookMeta(JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      fs.writeFileSync(metaPath, writeBookMeta({ ...parsed.meta, title }), "utf8")
      library.refresh()
      return { ok: true, value: { title } }
    }

    if (role === "ocr") {
      const ocr = await checkOcr(value)
      if ("error" in ocr) return { ok: false, error: ocr.error }
      replaceAtomically(value, path.join(dataDir, "ocr.json"))

      // The page count is a fact about the OCR file, so it moves with it.
      const metaPath = path.join(dataDir, BOOK_FILES.meta)
      const parsed = parseBookMeta(JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown)
      if (parsed.ok && parsed.meta.pageCount !== ocr.pages) {
        fs.writeFileSync(metaPath, writeBookMeta({ ...parsed.meta, pageCount: ocr.pages }), "utf8")
      }
      library.refresh()
      return { ok: true, value: { pageCount: ocr.pages } }
    }

    if (role === "toc") {
      const tocError = checkToc(value)
      if (tocError) return { ok: false, error: tocError }
      replaceAtomically(value, path.join(dataDir, BOOK_FILES.toc))
      library.refresh()
      return { ok: true, value: {} }
    }

    if (role === "pdf") {
      const pdfError = checkPdf(value)
      if (pdfError) return { ok: false, error: pdfError }
      replaceAtomically(value, path.join(doc.dir, BOOK_FILES.pdf))
      library.refresh()
      return { ok: true, value: {} }
    }

    // cover
    const coverError = checkCover(value)
    if (coverError) return { ok: false, error: coverError }
    replaceAtomically(value, path.join(dataDir, `cover${path.extname(value).toLowerCase()}`))
    // Any other cover would still win the lookup order in `coverPath`, so the old one
    // goes — otherwise replacing cover.png with cover.jpg appears to do nothing.
    for (const name of COVER_NAMES) {
      if (`cover${path.extname(value).toLowerCase()}` === name) continue
      fs.rmSync(path.join(dataDir, name), { force: true })
    }
    library.refresh()
    return { ok: true, value: {} }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The metadata this module writes, re-exported so a caller imports one file. */
export type { BookMeta }
