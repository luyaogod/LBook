import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { BOOK_FORMAT_VERSION, LBOOK_DIR, writeBookMeta, type BookMeta } from "../../src/shared/bookFile"

/** One page element, in PaddleOCR's own shape. */
export function pageElement(n: number, extra: Record<string, unknown> = {}): unknown {
  return {
    prunedResult: {
      width: 1224,
      height: 1584,
      parsing_res_list: [
        { block_label: "text", block_content: `page ${n}`, block_bbox: [10, 20, 300, 60] },
      ],
      ...extra,
    },
    markdown: { text: `### page ${n}`, images: {} },
  }
}

export interface BookFolderOptions {
  /** Parent directory; a fresh temp dir is made when omitted. */
  parent?: string
  /** Folder name under the parent. */
  name?: string
  uid?: string
  title?: string
  pageCount?: number
  /** Write this instead of `meta.json` (e.g. broken JSON). */
  rawMeta?: string
  /** Omit `meta.json` entirely, as raw PaddleOCR output has none. */
  omitMeta?: boolean
  /** Name of the OCR file. */
  ocrFile?: string
  /** Omit the OCR file. */
  omitOcr?: boolean
  /** Omit book.pdf. */
  omitPdf?: boolean
  toc?: unknown
  cover?: { name: string; data: Buffer }
  /**
   * Write everything next to `book.pdf` instead of into `.lbook/`.
   *
   * That is the layout the app used before it had a metadata directory, and it is
   * not read any more — but a folder somebody hands you may still look like this,
   * so the code that adopts one has to be testable.
   */
  loose?: boolean
}

export interface BookFolder {
  dir: string
  /** The `.lbook` directory holding the metadata (or the folder itself when loose). */
  dataDir: string
  uid: string
  meta: BookMeta
  metaPath: string
  ocrPath: string
  pdfPath: string
  /** The whole OCR document, as it sits on disk. */
  document: { layoutParsingResults: unknown[]; dataInfo: Record<string, unknown> }
}

/**
 * Writes a book folder the way the app expects to find one: `book.pdf` and a
 * `.lbook/` directory holding `meta.json`, `ocr.json` and the optional extras.
 *
 * Deliberately plain `fs` writes — the folder layout is the contract other tools
 * have to be able to produce by hand, so nothing here goes through app code.
 */
export function createBookFolder(options: BookFolderOptions = {}): BookFolder {
  const parent = options.parent ?? fs.mkdtempSync(path.join(os.tmpdir(), "lbook-book-"))
  const dir = path.join(parent, options.name ?? `book-${Math.random().toString(36).slice(2, 8)}`)
  const dataDir = options.loose ? dir : path.join(dir, LBOOK_DIR)
  fs.mkdirSync(dataDir, { recursive: true })

  const uid = options.uid ?? "0123456789abcdef0123456789abcdef"
  const pageCount = options.pageCount ?? 3
  const document = {
    layoutParsingResults: Array.from({ length: pageCount }, (_, i) => pageElement(i + 1)),
    dataInfo: { type: "pdf", numPages: pageCount, pages: [] },
  }

  const meta: BookMeta = {
    formatVersion: BOOK_FORMAT_VERSION,
    uid,
    title: options.title ?? "Test Book",
    pageCount,
    ocrFile: options.ocrFile ?? "ocr.json",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "test",
  }

  const ocrPath = path.join(dataDir, meta.ocrFile)
  if (!options.omitOcr) {
    // Written the way PaddleOCR writes it: one document, not a page per file. The
    // scanner is given the real bytes so the offset index is exercised for real.
    fs.writeFileSync(ocrPath, JSON.stringify(document), "utf8")
  }

  const pdfPath = path.join(dir, "book.pdf")
  if (!options.omitPdf) {
    fs.writeFileSync(pdfPath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(512, 0x41)]))
  }

  const metaPath = path.join(dataDir, "meta.json")
  if (options.rawMeta !== undefined) {
    fs.writeFileSync(metaPath, options.rawMeta, "utf8")
  } else if (!options.omitMeta) {
    fs.writeFileSync(metaPath, writeBookMeta(meta), "utf8")
  }

  if (options.toc !== undefined) {
    fs.writeFileSync(path.join(dataDir, "toc.json"), JSON.stringify(options.toc), "utf8")
  }
  if (options.cover) {
    fs.writeFileSync(path.join(dataDir, options.cover.name), options.cover.data)
  }

  return { dir, dataDir, uid, meta, metaPath, ocrPath, pdfPath, document }
}

/** A temp directory removed by the returned cleanup, for ledger/progress files. */
export function createTempRoot(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-lib-"))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
