import { parseBookMeta } from "./bookFile"
import { parseToc } from "./toc"

/**
 * What is wrong with a book folder.
 *
 * One set of rules and one set of messages, used in two places: the library listing
 * (which only looks at what is cheap — `meta.json` and the PDF's first bytes) and the
 * "why is this book broken?" detail, which reads the whole OCR file and can point at
 * a byte offset (T2/T3 in `02-phase2-reactivity-validation.md`).
 *
 * **This module does no I/O and never throws.** It is handed a digest of what
 * somebody else already read; a validator that crashed on a strange file would take
 * the library down with it, which is the failure it exists to prevent. Zero
 * dependencies, so it runs in the renderer's tests as happily as in the main process.
 *
 * Two levels, and the difference matters for what the reader sees:
 *
 * - `error` — the book cannot be read, or a whole part of it cannot.
 * - `warn`  — the book reads, but something in it is off (a single bad page, a page
 *             count that disagrees, a `toc.json` with a typo).
 */

export type IssueLevel = "error" | "warn"

export interface BookIssue {
  level: IssueLevel
  /** Which file the problem is in, as it is named on disk. */
  file: "meta.json" | "ocr.json" | "toc.json" | "book.pdf" | "folder"
  /** One sentence, in the language the interface uses for diagnostics. */
  message: string
  /** Byte offset in `file`, when we know it (the scanner reports where a page starts). */
  offset?: number
  /** Where inside the JSON, e.g. `layoutParsingResults[300].prunedResult`. */
  jsonPath?: string
}

/** A page element the scanner found something wrong with. */
export interface OcrFinding {
  /** 0-based, i.e. the array index — the same number the app calls a page minus one (A8). */
  pageIndex: number
  /** Byte offset of the element in the OCR file. */
  offset: number
  message: string
  jsonPath: string
}

export interface OcrFacts {
  fileBytes: number
  /** Pages found so far. */
  pageCount: number
  /**
   * True when the scan reached the end of the array. False means "at least this
   * many pages", which is all a listing needs to know.
   */
  complete: boolean
  /** False when the file has no `layoutParsingResults` array at all. */
  hasArray: boolean
  findings: OcrFinding[]
  /**
   * What a whole-file `JSON.parse` made of it, or null when that was not attempted
   * (the cheap path does not read the file into memory).
   *
   * Worth knowing even though this app does not need it: the page reader works on
   * byte ranges, so it happily reads a file whose elements are fine but whose
   * *punctuation* is not — a missing comma between two pages, say. PaddleOCR's own
   * tools, the user's editor and any JSON formatter will refuse that file, so the
   * reader deserves to be told before they open it somewhere else and think it is
   * fine here.
   */
  wholeFile: { arrayLength: number } | { error: string; offset: number | null } | null
}

export type MetaDigest =
  | { kind: "missing" }
  | { kind: "unparseable"; error: string }
  | { kind: "parsed"; raw: unknown }

export type OcrDigest =
  | { kind: "missing" }
  | { kind: "unreadable"; error: string }
  | { kind: "facts"; facts: OcrFacts }

export type TocDigest =
  | { kind: "missing" }
  | { kind: "unreadable"; error: string }
  | { kind: "text"; text: string }

/** Everything the validator is allowed to look at. Collected by `library/inspect.ts`. */
export interface BookDigest {
  dir: string
  /** File names inside the `.lbook` directory, from one `readdir`. */
  files: string[]
  /**
   * True when a `meta.json` sits next to `book.pdf` instead of inside `.lbook/`.
   *
   * Not a supported layout: the app converts a folder like that when it is added
   * (see `adopt` in `library.ts`), so meeting one here means the reader has to be
   * told what is wrong rather than handed "there is no meta.json".
   */
  looseMeta: boolean
  meta: MetaDigest
  ocr: OcrDigest
  toc: TocDigest
  /** The first bytes of `book.pdf`, or null when there is no PDF. */
  pdfHeader: string | null
  /** True when `book.pdf` exists at all (distinguishes "missing" from "empty"). */
  hasPdf: boolean
}

const PDF_MAGIC = "%PDF-"

/**
 * Checks one page element of the OCR JSON.
 *
 * The rules follow what the reader actually consumes: the page is an object,
 * `prunedResult` (if present) is an object, `parsing_res_list` (if present) is an
 * array, and every block's `block_bbox` is four numbers — a box the overlay cannot
 * draw is worse than no box, because it lands somewhere arbitrary.
 *
 * Nothing here throws on a strange value; a weird page is reported, not fatal. That
 * is the difference between "page 300 is broken" and "your library is broken".
 */
export function checkOcrPage(element: unknown, pageIndex: number, offset: number): OcrFinding[] {
  const findings: OcrFinding[] = []
  const at = (suffix: string) => `layoutParsingResults[${pageIndex}]${suffix}`

  const push = (message: string, jsonPath: string) =>
    findings.push({ pageIndex, offset, message, jsonPath })

  if (element === null || typeof element !== "object" || Array.isArray(element)) {
    push(`page ${pageIndex + 1} is not an object`, at(""))
    return findings
  }

  const page = element as Record<string, unknown>
  const pruned = page.prunedResult
  if (pruned !== undefined && (pruned === null || typeof pruned !== "object" || Array.isArray(pruned))) {
    push(`page ${pageIndex + 1} has a prunedResult that is not an object`, at(".prunedResult"))
    return findings
  }

  const list = (pruned as Record<string, unknown> | undefined)?.parsing_res_list
  if (list === undefined) return findings
  if (!Array.isArray(list)) {
    push(
      `page ${pageIndex + 1} has a parsing_res_list that is not an array`,
      at(".prunedResult.parsing_res_list"),
    )
    return findings
  }

  for (const [blockIndex, block] of list.entries()) {
    if (block === null || typeof block !== "object" || Array.isArray(block)) {
      push(
        `page ${pageIndex + 1} block ${blockIndex} is not an object`,
        at(`.prunedResult.parsing_res_list[${blockIndex}]`),
      )
      continue
    }
    const bbox = (block as Record<string, unknown>).block_bbox
    if (bbox === undefined || bbox === null) continue
    const usable =
      Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => typeof n === "number" && Number.isFinite(n))
    if (!usable) {
      push(
        `page ${pageIndex + 1} block ${blockIndex} has a block_bbox that is not four numbers`,
        at(`.prunedResult.parsing_res_list[${blockIndex}].block_bbox`),
      )
    }
  }

  return findings
}

/**
 * Validates a book folder.
 *
 * The order of the checks is the order the app needs them: is this a book at all,
 * can it be read, and only then is anything in it merely suspicious.
 */
export function validateBook(digest: BookDigest): BookIssue[] {
  const issues: BookIssue[] = []
  const error = (file: BookIssue["file"], message: string): void => {
    issues.push({ level: "error", file, message })
  }
  const warn = (file: BookIssue["file"], message: string, extra: Partial<BookIssue> = {}): void => {
    issues.push({ level: "warn", file, message, ...extra })
  }

  // ---- meta.json: the book's identity ------------------------------------
  let meta: ReturnType<typeof parseBookMeta> | null = null
  if (digest.meta.kind === "missing") {
    if (digest.looseMeta) {
      error(
        "meta.json",
        "this folder has meta.json next to book.pdf instead of inside .lbook/: add the folder again and the app will move it in",
      )
    } else {
      error("meta.json", "there is no .lbook/meta.json in this folder, so the app cannot tell what book it is")
    }
  } else if (digest.meta.kind === "unparseable") {
    error("meta.json", `meta.json is not valid JSON: ${digest.meta.error}`)
  } else {
    meta = parseBookMeta(digest.meta.raw)
    if (!meta.ok) {
      error("meta.json", meta.error)
      meta = null
    }
  }

  // ---- the OCR file -------------------------------------------------------
  const ocrName = meta?.ok ? meta.meta.ocrFile : "ocr.json"
  if (digest.ocr.kind === "missing") {
    error("ocr.json", `${ocrName} is not in the .lbook folder`)
  } else if (digest.ocr.kind === "unreadable") {
    error("ocr.json", `${ocrName} could not be read: ${digest.ocr.error}`)
  } else {
    const { facts } = digest.ocr
    if (!facts.hasArray) {
      // "Not a PaddleOCR file" and "a PaddleOCR file with no pages" are different
      // things to tell somebody who has just edited their file by hand.
      error("ocr.json", `${ocrName} has no layoutParsingResults array`)
    } else if (facts.pageCount === 0) {
      error("ocr.json", `${ocrName} has an empty layoutParsingResults array`)
    }
    if (!facts.complete) {
      warn("ocr.json", `${ocrName} was not read in full, so its pages were not all checked`)
    }

    if (facts.wholeFile) {
      if ("error" in facts.wholeFile) {
        const extra: Partial<BookIssue> = {}
        if (facts.wholeFile.offset !== null) extra.offset = facts.wholeFile.offset
        warn(
          "ocr.json",
          `${ocrName} cannot be parsed as a whole (${facts.wholeFile.error}). ` +
            `The pages still read one by one, but other tools will refuse this file`,
          extra,
        )
      } else if (facts.wholeFile.arrayLength !== facts.pageCount) {
        // The byte scanner and the JSON parser disagreeing means this app is reading
        // the file wrong, which is worth saying loudly rather than quietly showing the
        // wrong number of pages.
        error(
          "ocr.json",
          `the page scanner found ${facts.pageCount} pages but the file's array holds ` +
            `${facts.wholeFile.arrayLength}: this is a bug in LBook, please report it`,
        )
      }
    }
    for (const finding of facts.findings) {
      warn("ocr.json", finding.message, { offset: finding.offset, jsonPath: finding.jsonPath })
    }
  }

  // ---- meta.json against the files it describes --------------------------
  if (meta?.ok) {
    if (!digest.files.includes(meta.meta.ocrFile)) {
      // Reported by the OCR checks above as well; this line names the file the
      // meta.json itself asked for, which is the part the reader can act on.
      error("meta.json", `meta.json points at ${meta.meta.ocrFile}, which is not in the .lbook folder`)
    }

    if (digest.ocr.kind === "facts" && digest.ocr.facts.complete) {
      const actual = digest.ocr.facts.pageCount
      if (meta.meta.pageCount !== actual) {
        // A page is an array index (A8): if the array is shorter than the meta
        // claims, the last pages read as empty; if it is longer, the extra pages are
        // unreachable. Either way the numbers the reader sees are off, and that is
        // worth saying plainly.
        warn(
          "meta.json",
          `meta.json says ${meta.meta.pageCount} pages but the OCR file has ${actual}: ` +
            `page numbers past the shorter one will be off`,
        )
      }
    }
  }

  // ---- book.pdf ----------------------------------------------------------
  if (!digest.hasPdf) {
    error("book.pdf", "book.pdf is missing from this folder, so there is nothing to show")
  } else if (digest.pdfHeader !== null && !digest.pdfHeader.startsWith(PDF_MAGIC)) {
    error("book.pdf", "book.pdf does not start with %PDF-, so it is not a PDF file")
  }

  // ---- toc.json: optional, but a typo in it is worth a sentence ----------
  if (digest.toc.kind === "unreadable") {
    warn("toc.json", `toc.json could not be read: ${digest.toc.error}`)
  } else if (digest.toc.kind === "text") {
    try {
      parseToc(JSON.parse(digest.toc.text))
    } catch (cause) {
      warn("toc.json", `toc.json is not a valid table of contents: ${(cause as Error).message}`)
    }
  }

  return issues
}

/** The worst level in a list, or null when there is nothing wrong. */
export function worstLevel(issues: BookIssue[]): IssueLevel | null {
  if (issues.some((issue) => issue.level === "error")) return "error"
  if (issues.length > 0) return "warn"
  return null
}

/** One line for a list row: the first error, else the first warning, else null. */
export function summaryOf(issues: BookIssue[]): string | null {
  const first = issues.find((issue) => issue.level === "error") ?? issues[0]
  return first ? `${first.file}: ${first.message}` : null
}
