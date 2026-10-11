import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { BOOK_FORMAT_VERSION, writeBookMeta } from "../../shared/bookFile"
import { scanPageSpans } from "../lbook/offsetIndex"
import {
  ENTRY_OCR,
  ENTRY_PDF,
  ENTRY_TOC,
  parseManifest,
  slugify,
  type BookManifest,
} from "./manifest"
import { COMPRESSION_STORE, ZipArchive } from "./zipReader"

/**
 * One `.lbook` package → one book folder.
 *
 * This is the only code in the repository that still reads the old format, and it
 * runs once, from `scripts/migrate-folders.ts`. Nothing in the app calls it (A12).
 *
 * The rules it obeys, in order of importance:
 *
 * 1. **The package is never touched.** It is opened read-only; nothing is moved,
 *    renamed or deleted. If the migration goes wrong the old library is still there.
 * 2. **`ocr.json` is copied byte for byte.** Not re-serialized, not re-indented
 *    (A7): the file the user ends up owning has to be the file PaddleOCR produced.
 * 3. **`book.pdf` is streamed and hashed while it is written**, so a 190MB book
 *    never sits in memory, and the copy is proven correct against the package's
 *    own `pdfSha256` before the folder is put in place.
 * 4. **All or nothing.** The folder is built next to its final name and only
 *    renamed into place once every file is written and verified, so an interrupted
 *    or failed run leaves no half-book behind.
 * 5. **Idempotent.** A book already in the library, or a folder that already holds
 *    this uid, is skipped rather than migrated twice.
 *
 * `meta.json` is written with the manifest's `uid`, which is what keeps reading
 * progress (keyed by uid) attached to the book across the move.
 */

/** PDF copy chunk. 8MB keeps peak memory flat without making the write loop hot. */
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024

export type MigrateOutcome =
  | {
      status: "skipped"
      uid: string
      dir: string
      reason: string
    }
  | {
      status: "planned"
      uid: string
      dir: string
      title: string
      /**
       * What the package claims. A dry run does not read the OCR file — it reports
       * the manifest as it stands, and the real run says so if the two disagree.
       */
      manifestPageCount: number
      pdfBytes: number
    }
  | {
      status: "migrated"
      uid: string
      dir: string
      title: string
      /** Pages actually in the copied `ocr.json` (what `meta.json` records). */
      pageCount: number
      /** What the old manifest claimed, when it disagreed. */
      manifestPageCount: number
      pdfBytes: number
      pdfSha256: string
      ocrBytes: number
      hasToc: boolean
      hasCover: boolean
      elapsedMs: number
    }
  | { status: "failed"; error: string }

export interface MigrateInput {
  /** The `.lbook` to convert. */
  packagePath: string
  /** Where the book folder is created (the default new-book location). */
  targetRoot: string
  /**
   * uid → folder, from the library ledger. A book that is already registered is
   * skipped, so running the migration twice is a no-op instead of a second copy.
   */
  registered?: Map<string, string>
  /** Decide only; write nothing. */
  dryRun?: boolean
  chunkBytes?: number
}

export async function migratePackage(input: MigrateInput): Promise<MigrateOutcome> {
  const started = process.hrtime.bigint()
  const chunkBytes = input.chunkBytes ?? DEFAULT_CHUNK_BYTES
  let staging: string | null = null

  try {
    const archive = await ZipArchive.open(input.packagePath)
    try {
      const manifest = await readManifestFrom(archive)
      const uid = manifest.uid

      const alreadyRegistered = input.registered?.get(uid)
      if (alreadyRegistered !== undefined) {
        return {
          status: "skipped",
          uid,
          dir: alreadyRegistered,
          reason: "already in the library",
        }
      }

      const ocrEntry = archive.getEntry(ENTRY_OCR)
      if (!ocrEntry) {
        return { status: "failed", error: "the package has no ocr.json" }
      }

      const pdfEntry = archive.getEntry(ENTRY_PDF)
      if (!pdfEntry) {
        return { status: "failed", error: "the package has no book.pdf" }
      }

      const target = pickTargetDir(input.targetRoot, manifest, uid)
      if (target.existing) {
        return {
          status: "skipped",
          uid,
          dir: target.dir,
          reason: "this folder already holds this book",
        }
      }

      if (input.dryRun) {
        return {
          status: "planned",
          uid,
          dir: target.dir,
          title: manifest.title,
          manifestPageCount: manifest.pageCount,
          pdfBytes: pdfEntry.uncompressedSize,
        }
      }

      // Built under a dot-prefixed name so an interrupted run cannot be mistaken
      // for a finished book, then renamed in one step below.
      staging = path.join(input.targetRoot, `.migrating-${uid.slice(0, 8)}`)
      fs.rmSync(staging, { recursive: true, force: true })
      fs.mkdirSync(staging, { recursive: true })

      const pdfSha256 = await copyPdf(archive, path.join(staging, ENTRY_PDF), pdfEntry.uncompressedSize, chunkBytes)
      if (manifest.pdfSha256 && pdfSha256 !== manifest.pdfSha256) {
        throw new Error(
          `book.pdf does not match the package's own hash (expected ${manifest.pdfSha256.slice(0, 12)}…, wrote ${pdfSha256.slice(0, 12)}…)`,
        )
      }

      // Verbatim: the bytes on disk are the bytes PaddleOCR wrote.
      const ocrBytes = await writeEntryVerbatim(archive, ENTRY_OCR, path.join(staging, ENTRY_OCR))

      const hasToc = await writeOptionalEntry(archive, ENTRY_TOC, path.join(staging, ENTRY_TOC))
      const hasCover = await writeCover(archive, manifest, staging)

      // The page count comes from the copied file, not from the manifest: it is what
      // the reader will actually page through, and it is what `meta.json` must say
      // for the two to agree. A disagreement is reported rather than hidden.
      const scanned = await scanPageSpans(path.join(staging, ENTRY_OCR))
      if (scanned.spans.length === 0) {
        throw new Error("the copied ocr.json has no pages")
      }

      fs.writeFileSync(
        path.join(staging, "meta.json"),
        writeBookMeta({
          formatVersion: BOOK_FORMAT_VERSION,
          uid,
          title: manifest.title,
          ...(manifest.author ? { author: manifest.author } : {}),
          pageCount: scanned.spans.length,
          ocrFile: ENTRY_OCR,
          createdAt: manifest.createdAt,
          source: "migrated from .lbook",
        }),
        "utf8",
      )

      fs.renameSync(staging, target.dir)
      staging = null

      return {
        status: "migrated",
        uid,
        dir: target.dir,
        title: manifest.title,
        pageCount: scanned.spans.length,
        manifestPageCount: manifest.pageCount,
        pdfBytes: pdfEntry.uncompressedSize,
        pdfSha256,
        ocrBytes,
        hasToc,
        hasCover,
        elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      }
    } finally {
      await archive.close()
    }
  } catch (error) {
    // Nothing half-written is left behind: the staging folder goes, the package
    // stays exactly as it was.
    if (staging) fs.rmSync(staging, { recursive: true, force: true })
    return { status: "failed", error: error instanceof Error ? error.message : String(error) }
  }
}

async function readManifestFrom(archive: ZipArchive): Promise<BookManifest> {
  const text = await archive.readText("manifest.json")
  return parseManifest(text)
}

/**
 * Where this book's folder goes.
 *
 * A title that collides with another book's gets a `-2` / `-3` suffix rather than
 * overwriting it. A folder that already holds **this** uid is the same book from an
 * earlier run, and is reported so the caller skips it instead of writing a second
 * copy under a new name.
 */
function pickTargetDir(
  root: string,
  manifest: BookManifest,
  uid: string,
): { dir: string; existing: boolean } {
  const stem = slugify(manifest.title)
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? stem : `${stem}-${n}`
    const dir = path.join(root, name)
    if (!fs.existsSync(dir)) return { dir, existing: false }

    const meta = readMetaUid(path.join(dir, "meta.json"))
    if (meta === uid) return { dir, existing: true }
  }
  throw new Error(`cannot find a free folder name for "${manifest.title}"`)
}

function readMetaUid(file: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { uid?: unknown }
    return typeof raw.uid === "string" ? raw.uid : null
  } catch {
    return null
  }
}

/** Streams `book.pdf` out, hashing as it writes. Never holds the book in memory. */
async function copyPdf(
  archive: ZipArchive,
  target: string,
  size: number,
  chunkBytes: number,
): Promise<string> {
  const hash = createHash("sha256")
  const handle = fs.openSync(target, "w")
  try {
    if (archive.getEntry(ENTRY_PDF)?.compressionMethod !== COMPRESSION_STORE) {
      // Only possible for a package written by an early build (book.pdf has been
      // stored since the format settled). Inflating needs the whole entry in
      // memory, which is why it is a fallback and not the path.
      console.warn("[migrate] book.pdf is compressed in this package; inflating it whole")
      const data = await archive.readEntry(ENTRY_PDF)
      hash.update(data)
      fs.writeSync(handle, data)
      return hash.digest("hex")
    }

    let offset = 0
    while (offset < size) {
      const length = Math.min(chunkBytes, size - offset)
      const chunk = await archive.readRange(ENTRY_PDF, offset, offset + length - 1)
      if (chunk.length === 0) break
      hash.update(chunk)
      fs.writeSync(handle, chunk)
      offset += chunk.length
    }
    return hash.digest("hex")
  } finally {
    fs.closeSync(handle)
  }
}

/** Writes an entry's uncompressed bytes exactly as they are. Returns the size. */
async function writeEntryVerbatim(
  archive: ZipArchive,
  entryName: string,
  target: string,
): Promise<number> {
  const data = await archive.readEntry(entryName)
  fs.writeFileSync(target, data)
  return data.length
}

/** Copies an optional entry. Returns false when the package does not have it. */
async function writeOptionalEntry(
  archive: ZipArchive,
  entryName: string,
  target: string,
): Promise<boolean> {
  if (!archive.has(entryName)) return false
  fs.writeFileSync(target, await archive.readEntry(entryName))
  return true
}

/**
 * The cover, under the name the manifest gave it.
 *
 * Book folders are read by looking for `cover.<ext>` (see `library/book.ts`), so the
 * entry name is kept as it is rather than renamed to a fixed file name.
 */
async function writeCover(archive: ZipArchive, manifest: BookManifest, staging: string): Promise<boolean> {
  const name = manifest.cover?.name
  if (!name || !archive.has(name)) return false
  // A cover name is data from a package we are reading, not a path the user typed;
  // keep it to a plain file name so nothing can be written outside the new folder.
  if (name.includes("/") || name.includes("\\") || name.startsWith(".")) return false
  fs.writeFileSync(path.join(staging, name), await archive.readEntry(name))
  return true
}
