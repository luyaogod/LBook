import fs from "node:fs"
import path from "node:path"
import {
  checkOcrPage,
  validateBook,
  type BookDigest,
  type BookIssue,
  type OcrFinding,
} from "../../shared/validateBook"
import { BOOK_FILES, LBOOK_DIR } from "../../shared/bookFile"
import { readSpan, scanPageSpans } from "../lbook/offsetIndex"
import { dataDirOf } from "./book"

/**
 * Reads a book folder and runs the validation rules over it.
 *
 * The split is deliberate: `src/shared/validateBook.ts` holds the rules and the
 * messages and touches nothing, this file does the reading. That is what lets the
 * listing use the cheap half (it only re-checks `meta.json` and the files' existence,
 * see `library.ts`) while the "why is this broken?" detail gets the expensive half,
 * including a byte offset for the page that is wrong.
 *
 * **The deep check parses the whole OCR file**, so it is a user-initiated action:
 * about 300ms on the largest book here. The library listing never calls it.
 */

export interface InspectOptions {
  /**
   * Parse every page element and report the malformed ones.
   *
   * False is enough to answer "is this book readable?", which is what happens when a
   * book is opened: it scans the index (needed anyway) but parses no pages.
   */
  deep?: boolean
}

export async function inspectBook(dir: string, options: InspectOptions = {}): Promise<BookIssue[]> {
  const digest = await readDigest(dir, options.deep === true)
  return validateBook(digest)
}

/** The cheap half: everything the validator can know without parsing any page. */
export async function readDigest(dir: string, deep: boolean): Promise<BookDigest> {
  const dataDir = dataDirOf(dir)
  let files: string[] = []
  try {
    files = fs.readdirSync(dataDir)
  } catch {
    // A folder that is not there reads as a folder with nothing in it, which the
    // validator reports as "no meta.json".
  }

  // A folder from before the `.lbook` layout is worth naming as such instead of
  // leaving the reader with "there is no .lbook/meta.json": the files are right
  // there, one level up.
  const looseMeta = fs.existsSync(path.join(dir, BOOK_FILES.meta))

  const metaPath = path.join(dataDir, BOOK_FILES.meta)
  const metaText = readText(metaPath)
  let meta: BookDigest["meta"]
  if (metaText === null) {
    meta = { kind: "missing" }
  } else {
    try {
      meta = { kind: "parsed", raw: JSON.parse(metaText) as unknown }
    } catch (error) {
      meta = { kind: "unparseable", error: (error as Error).message }
    }
  }

  // Which OCR file to look at: what meta.json asks for, falling back to the
  // conventional name so a folder with a broken meta.json still reports the OCR
  // problems it can see.
  let ocrName = "ocr.json"
  if (meta.kind === "parsed" && meta.raw && typeof meta.raw === "object") {
    const named = (meta.raw as Record<string, unknown>).ocrFile
    if (typeof named === "string" && named !== "" && !named.includes("/") && !named.includes("\\")) {
      ocrName = named
    }
  }
  const ocrPath = path.join(dataDir, ocrName)

  const ocr: BookDigest["ocr"] = await readOcr(ocrPath, deep)

  const tocPath = path.join(dataDir, BOOK_FILES.toc)
  const hasToc = fs.existsSync(tocPath)
  const tocText = hasToc ? readText(tocPath) : null
  const toc: BookDigest["toc"] = !hasToc
    ? { kind: "missing" }
    : tocText === null
      ? { kind: "unreadable", error: "the file could not be read" }
      : { kind: "text", text: tocText }

  const pdfPath = path.join(dir, BOOK_FILES.pdf)
  const hasPdf = fs.existsSync(pdfPath)

  return {
    dir,
    files,
    looseMeta,
    meta,
    ocr,
    toc,
    hasPdf,
    pdfHeader: hasPdf ? readHeader(pdfPath, 8) : null,
  }
}

/** Kept in a variable so the two readers below cannot drift on the wording. */
export const dataDirName = LBOOK_DIR

async function readOcr(ocrPath: string, deep: boolean): Promise<BookDigest["ocr"]> {
  if (!fs.existsSync(ocrPath)) return { kind: "missing" }

  let scanned: Awaited<ReturnType<typeof scanPageSpans>>
  try {
    scanned = await scanPageSpans(ocrPath, deep ? {} : { limit: 1 })
  } catch (error) {
    return { kind: "unreadable", error: (error as Error).message }
  }

  const findings: OcrFinding[] = []
  if (deep && scanned.foundArray) {
    for (const [index, span] of scanned.spans.entries()) {
      try {
        findings.push(...checkOcrPage(readSpan(ocrPath, span), index, span.start))
      } catch (error) {
        // A slice that will not parse means the file was edited into an invalid
        // state (a brace was lost before this page). That is a finding about *this*
        // page, not a reason to fail the whole inspection.
        findings.push({
          pageIndex: index,
          offset: span.start,
          message: `page ${index + 1} could not be parsed: ${(error as Error).message}`,
          jsonPath: `layoutParsingResults[${index}]`,
        })
      }
    }
  }

  return {
    kind: "facts",
    facts: {
      fileBytes: scanned.fileBytes,
      pageCount: scanned.spans.length,
      hasArray: scanned.foundArray,
      // A shallow scan stops after a page or two by design, so it can never claim to
      // have seen the end of the array; the page-count comparison in the validator
      // therefore only runs after a deep inspection.
      complete: deep,
      findings,
      wholeFile: deep ? checkWholeFile(ocrPath, scanned.spans.length) : null,
    },
  }
}

/**
 * Parses the whole file once, to catch damage the byte reader cannot see.
 *
 * Reading page by page means a missing comma between two pages is invisible to this
 * app — each slice is still valid JSON — while every other tool refuses the file. One
 * `JSON.parse` behind a button answers that, and its failure message carries the byte
 * position V8 stopped at.
 */
function checkWholeFile(
  ocrPath: string,
  scannedPages: number,
): { arrayLength: number } | { error: string; offset: number | null } {
  let text: string
  try {
    text = fs.readFileSync(ocrPath, "utf8")
  } catch (error) {
    return { error: (error as Error).message, offset: null }
  }

  try {
    const parsed = JSON.parse(text) as unknown
    const results = Array.isArray(parsed)
      ? parsed
      : (parsed as { layoutParsingResults?: unknown })?.layoutParsingResults
    const arrayLength = Array.isArray(results) ? results.length : 0
    return { arrayLength: arrayLength === 0 ? scannedPages : arrayLength }
  } catch (error) {
    return { error: (error as Error).message, offset: positionFrom(error) }
  }
}

/** V8 says "… in JSON at position 4282014 (line 1 column 4282015)". */
function positionFrom(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error)
  const match = /position (\d+)/.exec(message)
  return match ? Number(match[1]) : null
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function readHeader(file: string, bytes: number): string | null {
  try {
    const handle = fs.openSync(file, "r")
    try {
      const buffer = Buffer.alloc(bytes)
      const read = fs.readSync(handle, buffer, 0, bytes, 0)
      return buffer.subarray(0, read).toString("latin1")
    } finally {
      fs.closeSync(handle)
    }
  } catch {
    return null
  }
}
