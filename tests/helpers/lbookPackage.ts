import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import yazl from "yazl"
import {
  ENTRY_MANIFEST,
  ENTRY_OCR,
  ENTRY_PDF,
  ENTRY_TOC,
  LBOOK_FORMAT,
  LBOOK_FORMAT_VERSION,
  packageFileName,
} from "../../src/main/migrate/manifest"

/** Pages in the fixture's OCR document, as a real package's manifest would count them. */
function ocrPageCount(ocr: unknown | null): number {
  if (ocr === null || typeof ocr !== "object") return 1
  const results = (ocr as { layoutParsingResults?: unknown }).layoutParsingResults
  return Array.isArray(results) && results.length > 0 ? results.length : 1
}

/**
 * A minimal but real PDF header, so `%PDF-` assertions are meaningful.
 *
 * The one-time converter copies a package's `book.pdf` byte for byte; a test that
 * checks the copy is faithful needs a file whose bytes are recognisable.
 */
export function fakePdf(size = 4096): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(size, 0x41), Buffer.from("\n%%EOF\n")])
}

export interface BuildBookOptions {
  dir: string
  title?: string
  uid?: string
  pdf?: Buffer
  /** Compress book.pdf — used to prove the STORE requirement is enforced. */
  compressPdf?: boolean
  ocr?: unknown | null
  /** Omit manifest.json entirely. */
  omitManifest?: boolean
  /** Replace manifest.json with arbitrary bytes/text. */
  rawManifest?: string
  cover?: { name: string; data: Buffer } | null
  /** Written as the package's toc.json entry. */
  toc?: unknown | null
  extra?: Array<{ name: string; data: Buffer }>
  manifestOverrides?: Record<string, unknown>
}

export interface BuiltBook {
  filePath: string
  uid: string
  pdf: Buffer
}

/** Builds a .lbook package on disk for tests. */
export async function buildLbook(options: BuildBookOptions): Promise<BuiltBook> {
  const {
    dir,
    title = "Test Book",
    uid = "testuid0000000",
    pdf = fakePdf(),
    compressPdf = false,
    ocr = { layoutParsingResults: [], dataInfo: {} },
    omitManifest = false,
    rawManifest,
    cover = null,
    toc = null,
    extra = [],
    manifestOverrides = {},
  } = options

  const filePath = path.join(dir, packageFileName(title, uid))

  const manifest = {
    format: LBOOK_FORMAT,
    formatVersion: LBOOK_FORMAT_VERSION,
    uid,
    title,
    author: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    // The manifest of a real package describes the pages its OCR file holds, so
    // the fixture derives it too; a test that wants a lying manifest overrides it.
    pageCount: ocrPageCount(ocr),
    pdfSize: pdf.length,
    // Hash the bytes the fixture actually contains: the migration verifies its copy
    // against this, so a manifest that lies about its own PDF has to be a tests
    // deliberate choice rather than the fixtures default.
    pdfSha256: createHash("sha256").update(pdf).digest("hex"),
    hasOcr: ocr !== null,
    cover: cover ? { name: cover.name, mime: "image/jpeg" } : null,
    generator: "test",
    ...manifestOverrides,
  }

  await new Promise<void>((resolve, reject) => {
    const zip = new yazl.ZipFile()
    const output = fs.createWriteStream(filePath)
    zip.outputStream.pipe(output)
    output.on("close", resolve)
    output.on("error", reject)
    zip.outputStream.on("error", reject)

    // book.pdf MUST be first and stored — that is the package contract.
    zip.addBuffer(pdf, ENTRY_PDF, { compress: compressPdf })

    if (!omitManifest) {
      zip.addBuffer(Buffer.from(rawManifest ?? JSON.stringify(manifest), "utf8"), ENTRY_MANIFEST)
    }
    if (ocr !== null) {
      zip.addBuffer(Buffer.from(JSON.stringify(ocr), "utf8"), ENTRY_OCR)
    }
    if (toc !== null) {
      zip.addBuffer(Buffer.from(JSON.stringify(toc), "utf8"), ENTRY_TOC)
    }
    if (cover) {
      zip.addBuffer(cover.data, cover.name)
    }
    for (const entry of extra) {
      zip.addBuffer(entry.data, entry.name)
    }

    zip.end()
  })

  return { filePath, uid, pdf }
}
