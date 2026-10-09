import fs from "node:fs"
import path from "node:path"
import { crc32 } from "node:zlib"
import yazl from "yazl"
import {
  ENTRY_MANIFEST,
  ENTRY_OCR,
  ENTRY_PDF,
  LBOOK_FORMAT,
  LBOOK_FORMAT_VERSION,
  packageFileName,
} from "../../src/main/lbook/manifest"

/** A minimal but real PDF header, so `%PDF-` assertions are meaningful. */
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

/**
 * Writes a minimal, hand-built ZIP containing stored entries.
 *
 * yazl refuses to emit hostile names (absolute paths, `..`, backslashes), which
 * is exactly what a hostile .lbook arriving from elsewhere could contain. This
 * bypasses the writer so those paths can be exercised on the read side.
 */
export function writeRawZip(
  filePath: string,
  entries: Array<{ name: string; data: Buffer }>,
): string {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8")
    const checksum = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, nameBytes, data)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  fs.writeFileSync(filePath, Buffer.concat([...localParts, centralDirectory, end]))
  return filePath
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
