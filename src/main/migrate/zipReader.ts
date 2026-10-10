import { promises as fsp } from "node:fs"
import { inflateRawSync } from "node:zlib"
import yauzl from "yauzl"

export const COMPRESSION_STORE = 0
export const COMPRESSION_DEFLATE = 8

/** Fixed part of a ZIP local file header, followed by name then extra field. */
const LOCAL_HEADER_FIXED_SIZE = 30
const LOCAL_HEADER_SIGNATURE = 0x04034b50

export interface ZipEntryInfo {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  relativeOffsetOfLocalHeader: number
}

/** Rejects absolute paths, `..` segments and backslashes (zip-slip). */
export function isSafeEntryName(name: string): boolean {
  if (name === "" || name.startsWith("/") || name.includes("\\")) return false
  if (/^[a-zA-Z]:/.test(name)) return false
  return !name.split("/").includes("..")
}

function parseCentralDirectory(
  filePath: string,
  entries: Map<string, ZipEntryInfo>,
  unsafeEntryNames: string[],
): Promise<void> {
  // yauzl opens and closes its own descriptor here; we read through a separate
  // handle afterwards, so there is exactly one owner of each fd at any time.
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error(`Failed to open zip: ${filePath}`))
        return
      }

      zipfile.on("entry", (entry: yauzl.Entry) => {
        if (isSafeEntryName(entry.fileName)) {
          entries.set(entry.fileName, {
            name: entry.fileName,
            compressionMethod: entry.compressionMethod,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize,
            crc32: entry.crc32,
            relativeOffsetOfLocalHeader: entry.relativeOffsetOfLocalHeader,
          })
        } else {
          unsafeEntryNames.push(entry.fileName)
        }
        zipfile.readEntry()
      })
      zipfile.on("end", () => resolve())
      zipfile.on("error", reject)
      zipfile.readEntry()
    })
  })
}

/**
 * Random-access reader for a .lbook (ZIP) package.
 *
 * The archive is never extracted. `readRange` maps byte ranges straight onto a
 * stored entry's raw data, which is what lets pdf.js stream a 189 MB book out of
 * the package without inflating or copying it. See DESIGN.md.
 */
export class ZipArchive {
  private readonly dataStarts = new Map<string, number>()
  private closed = false

  readonly filePath: string
  /** Entry names rejected by isSafeEntryName, surfaced by validate.ts. */
  readonly unsafeEntryNames: string[]
  private readonly handle: fsp.FileHandle
  private readonly entries: Map<string, ZipEntryInfo>

  private constructor(
    filePath: string,
    handle: fsp.FileHandle,
    entries: Map<string, ZipEntryInfo>,
    unsafeEntryNames: string[],
  ) {
    this.filePath = filePath
    this.handle = handle
    this.entries = entries
    this.unsafeEntryNames = unsafeEntryNames
  }

  static async open(filePath: string): Promise<ZipArchive> {
    const entries = new Map<string, ZipEntryInfo>()
    const unsafeEntryNames: string[] = []

    await parseCentralDirectory(filePath, entries, unsafeEntryNames)

    const handle = await fsp.open(filePath, "r")
    return new ZipArchive(filePath, handle, entries, unsafeEntryNames)
  }

  listEntries(): ZipEntryInfo[] {
    return [...this.entries.values()]
  }

  getEntry(name: string): ZipEntryInfo | null {
    return this.entries.get(name) ?? null
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  /**
   * Absolute offset of an entry's data within the archive.
   *
   * Reads the *local* file header rather than trusting the central directory's
   * name/extra lengths: the two records are permitted to disagree, and only the
   * local header describes the bytes actually on disk.
   */
  async dataStartOf(name: string): Promise<number> {
    const cached = this.dataStarts.get(name)
    if (cached !== undefined) return cached

    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Entry not found in archive: ${name}`)

    const header = Buffer.alloc(LOCAL_HEADER_FIXED_SIZE)
    await this.handle.read(header, 0, LOCAL_HEADER_FIXED_SIZE, entry.relativeOffsetOfLocalHeader)

    if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`Corrupt local file header for entry: ${name}`)
    }

    const nameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const dataStart =
      entry.relativeOffsetOfLocalHeader + LOCAL_HEADER_FIXED_SIZE + nameLength + extraLength

    this.dataStarts.set(name, dataStart)
    return dataStart
  }

  /** Reads `length` bytes of an entry's raw (possibly compressed) data. */
  private async readRaw(entry: ZipEntryInfo, offset: number, length: number): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0)
    const buffer = Buffer.alloc(length)
    const dataStart = await this.dataStartOf(entry.name)
    await this.handle.read(buffer, 0, length, dataStart + offset)
    return buffer
  }

  /**
   * Reads `[begin, end]` (inclusive) of an entry's *uncompressed* bytes.
   *
   * Only valid for stored entries. A deflated entry's byte ranges address
   * compressed data, so seeking into one would be meaningless — hence the throw.
   */
  async readRange(name: string, begin: number, end: number): Promise<Buffer> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Entry not found in archive: ${name}`)
    if (entry.compressionMethod !== COMPRESSION_STORE) {
      throw new Error(
        `Entry "${name}" is compressed (method ${entry.compressionMethod}); ` +
          `byte-range reads require a stored entry`,
      )
    }

    const start = Math.max(0, begin)
    const stop = Math.min(end, entry.uncompressedSize - 1)
    if (stop < start) return Buffer.alloc(0)

    return this.readRaw(entry, start, stop - start + 1)
  }

  /** Reads an entire entry, inflating it when necessary. */
  async readEntry(name: string): Promise<Buffer> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Entry not found in archive: ${name}`)

    if (entry.compressionMethod === COMPRESSION_STORE) {
      return this.readRaw(entry, 0, entry.uncompressedSize)
    }
    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
      return inflateRawSync(await this.readRaw(entry, 0, entry.compressedSize))
    }
    throw new Error(`Unsupported compression method ${entry.compressionMethod} for entry: ${name}`)
  }

  async readText(name: string): Promise<string> {
    return (await this.readEntry(name)).toString("utf8")
  }

  async readJson<T>(name: string): Promise<T> {
    return JSON.parse(await this.readText(name)) as T
  }

  /**
   * Releases the file handle.
   *
   * Callers MUST await this before replacing the package on disk: Windows
   * refuses to rename over a file that still has an open handle, and
   * `FileHandle.close()` resolves asynchronously.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // An already-closed handle is not an error worth surfacing.
    await this.handle.close().catch(() => {})
  }
}

/** Convenience for one-shot reads that do not warrant caching. */
export async function withArchive<T>(
  filePath: string,
  fn: (archive: ZipArchive) => Promise<T>,
): Promise<T> {
  const archive = await ZipArchive.open(filePath)
  try {
    return await fn(archive)
  } finally {
    await archive.close()
  }
}
