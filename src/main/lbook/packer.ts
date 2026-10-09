import { createReadStream, createWriteStream, promises as fsp, type ReadStream } from "node:fs"
import path from "node:path"
import { once } from "node:events"
import yazl from "yazl"

/**
 * Waits until the stream's file descriptor is actually released.
 *
 * `stream.finished()` can resolve on 'end' for a readable, which is before the
 * descriptor is closed. Renaming over a file whose handle is still open fails
 * with EPERM on Windows, so we wait for 'close' specifically.
 */
async function waitForClose(stream: ReadStream): Promise<void> {
  if (stream.closed) return
  await once(stream, "close")
}

/**
 * Windows can transiently refuse a replace-rename — antivirus and the search
 * indexer both open freshly written files. Retrying a few times is the standard
 * remedy and costs nothing when the first attempt succeeds.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fsp.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= attempts || (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY")) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt))
    }
  }
}
import type { BookCoverRef } from "../../shared/types"
import { sha256File } from "../library/hash"
import { createManifest, ENTRY_MANIFEST, ENTRY_OCR, ENTRY_PDF, ENTRY_TOC } from "./manifest"

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

export interface PackInput {
  pdfPath: string
  /** Raw PaddleOCR JSON text, already validated by the caller. */
  ocrJson?: string | null
  /** Raw toc.json text, already validated by the caller. */
  tocJson?: string | null
  coverPath?: string | null
  uid: string
  title: string
  author: string | null
  createdAt: string
  pageCount: number
  outputPath: string
}

export interface PackResult {
  pdfSize: number
  pdfSha256: string
  cover: BookCoverRef | null
}

function coverRefFor(coverPath: string | null | undefined): BookCoverRef | null {
  if (!coverPath) return null
  const extension = path.extname(coverPath).toLowerCase() || ".jpg"
  return { name: `cover${extension}`, mime: MIME_BY_EXTENSION[extension] ?? "image/jpeg" }
}

/**
 * Collects a yazl archive into `outputPath` atomically (temp file + rename).
 *
 * `settle` runs after the archive is written but before the rename — the hook
 * exists because repacking reads the PDF out of the very file being replaced,
 * and Windows refuses to rename over a file that still has an open handle.
 */
async function writeArchive(
  outputPath: string,
  build: (zip: yazl.ZipFile) => void,
  settle: () => Promise<void> = async () => {},
): Promise<void> {
  const tempPath = `${outputPath}.tmp`
  try {
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      const output = createWriteStream(tempPath)
      zip.outputStream.pipe(output)
      output.on("close", resolve)
      output.on("error", reject)
      zip.outputStream.on("error", reject)
      build(zip)
      zip.end()
    })

    await settle()
    await renameWithRetry(tempPath, outputPath)
  } catch (error) {
    await fsp.rm(tempPath, { force: true })
    throw error
  }
}

/**
 * Builds a .lbook package from a loose PDF plus its PaddleOCR output.
 *
 * `book.pdf` is added first and stored uncompressed. That is a hard requirement,
 * not a preference: ZipArchive.readRange maps byte offsets directly onto the
 * entry, which is only meaningful for stored data.
 */
export async function packLbook(input: PackInput): Promise<PackResult> {
  const stats = await fsp.stat(input.pdfPath)
  const pdfSha256 = await sha256File(input.pdfPath)
  const cover = coverRefFor(input.coverPath)

  const manifest = createManifest({
    uid: input.uid,
    title: input.title,
    author: input.author,
    createdAt: input.createdAt,
    pageCount: input.pageCount,
    pdfSize: stats.size,
    pdfSha256,
    hasOcr: Boolean(input.ocrJson),
    cover,
  })

  await writeArchive(input.outputPath, (zip) => {
    zip.addFile(input.pdfPath, ENTRY_PDF, { compress: false })
    zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), ENTRY_MANIFEST)
    if (input.ocrJson) {
      zip.addBuffer(Buffer.from(input.ocrJson, "utf8"), ENTRY_OCR)
    }
    if (input.tocJson) {
      zip.addBuffer(Buffer.from(input.tocJson, "utf8"), ENTRY_TOC)
    }
    if (input.coverPath && cover) {
      zip.addFile(input.coverPath, cover.name, { compress: true })
    }
  })

  return { pdfSize: stats.size, pdfSha256, cover }
}

export interface RepackInput {
  /** Existing package to rebuild from. */
  packagePath: string
  outputPath: string
  pdfSize: number
  /** Byte offset of book.pdf data inside the source package. */
  pdfDataStart: number
  manifestFields: {
    uid: string
    title: string
    author: string | null
    createdAt: string
    pageCount: number
    pdfSha256: string
    cover: BookCoverRef | null
  }
  /**
   * Entries to write. `null` omits the entry entirely, so the caller must pass
   * the *current* text when it only means to leave that entry alone — a repack
   * rebuilds the archive and would otherwise silently drop it.
   */
  ocrJson: string | null
  tocJson?: string | null
  /** Replacement cover bytes, or null to keep whatever the package already has. */
  coverBytes?: { name: string; mime: string; data: Buffer } | null
  backgroundCover?: { sourcePath: string } | null
}

/**
 * Rewrites a package, replacing its OCR payload, table of contents and/or cover.
 *
 * The PDF is streamed straight out of the source package's stored range, so it
 * is never inflated and never staged in a temporary file.
 *
 * This rebuilds the archive from scratch, so an entry the caller passes as null
 * is gone from the result. `library/service.ts` is responsible for reading back
 * the entries a given save does not intend to change.
 */
export async function repackLbook(input: RepackInput): Promise<void> {
  const { pdfSize, pdfDataStart, manifestFields } = input

  const manifest = createManifest({
    uid: manifestFields.uid,
    title: manifestFields.title,
    author: manifestFields.author,
    createdAt: manifestFields.createdAt,
    pageCount: manifestFields.pageCount,
    pdfSize,
    pdfSha256: manifestFields.pdfSha256,
    hasOcr: Boolean(input.ocrJson),
    cover: manifestFields.cover,
  })

  let pdfStream: ReadStream | null = null

  await writeArchive(
    input.outputPath,
    (zip) => {
      // Copy the stored PDF range verbatim — no decompression, no staging.
      pdfStream = createReadStream(input.packagePath, {
        start: pdfDataStart,
        end: pdfDataStart + pdfSize - 1,
      })
      zip.addReadStream(pdfStream, ENTRY_PDF, { compress: false, size: pdfSize })

      zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), ENTRY_MANIFEST)
      if (input.ocrJson) {
        zip.addBuffer(Buffer.from(input.ocrJson, "utf8"), ENTRY_OCR)
      }
      if (input.tocJson) {
        zip.addBuffer(Buffer.from(input.tocJson, "utf8"), ENTRY_TOC)
      }
      if (manifest.cover && input.coverBytes) {
        zip.addBuffer(input.coverBytes.data, manifest.cover.name, { compress: true })
      } else if (manifest.cover && input.backgroundCover) {
        zip.addFile(input.backgroundCover.sourcePath, manifest.cover.name, { compress: true })
      }
    },
    async () => {
      // The PDF stream reads out of the file we are about to rename over.
      if (pdfStream) await waitForClose(pdfStream)
    },
  )
}
