import fs from "node:fs"
import path from "node:path"
import yazl from "yazl"
import {
  ENTRY_MANIFEST,
  ENTRY_OCR,
  ENTRY_PDF,
  LBOOK_FORMAT,
  LBOOK_FORMAT_VERSION,
  packageFileName,
} from "../../src/main/migrate/manifest"

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
    pageCount: 1,
    pdfSize: pdf.length,
    pdfSha256: "0".repeat(64),
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
