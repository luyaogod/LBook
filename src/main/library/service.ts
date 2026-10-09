import { promises as fsp } from "node:fs"
import path from "node:path"
import type { ScanResult } from "../../shared/ipc"
import type {
  BookToc,
  OcrBlock,
  OcrPage,
  OcrPageBrief,
  PdfDocument,
  PdfDocumentDetail,
  ReadingProgress,
  User,
} from "../../shared/types"
import { randomUUID } from "node:crypto"
import { parseToc } from "../../shared/toc"
import { nowIso, type Repositories } from "../db"
import { toDocument } from "../db/repositories/documents"
import { parseOcrPayload, validateOcrJson } from "../lbook/ocr"
import { packageFileName, LBOOK_EXTENSION } from "../lbook/manifest"
import { packLbook, repackLbook } from "../lbook/packer"
import { buildOcrJsonFromDb } from "../lbook/reconstruct"
import {
  closeBook,
  pdfDataStart,
  readCover,
  readManifest,
  readOcrText,
  readPdfRange,
  readToc,
  readTocText,
} from "../lbook/reader"
import { sha256File } from "./hash"
import { ImportSkipped, importPackage } from "./importer"

export interface LibraryServiceDeps {
  repos: Repositories
  /** Resolved on every call so a library-dir change takes effect immediately. */
  getLibraryDir: () => string
}

export interface LibraryService {
  list(): PdfDocument[]
  get(pdfId: number): PdfDocumentDetail | null
  listPages(pdfId: number): OcrPageBrief[]
  getPage(pdfId: number, pageNum: number): OcrPage | null
  readPdfRange(pdfId: number, begin: number, end: number): Promise<Buffer>
  updateBlock(blockId: number, content: string): OcrBlock
  scan(): Promise<ScanResult>
  importFile(filePath: string): Promise<PdfDocument>
  createFromFiles(input: {
    pdfPath: string
    ocrPath: string
    coverPath: string | null
    tocPath?: string | null
    title?: string
    author?: string | null
  }): Promise<PdfDocument>
  /** Writes pending edits back into the .lbook. Part of the Excel-style save model. */
  save(pdfId: number): Promise<PdfDocument>
  /** The book's table of contents, or null when it has none. */
  getToc(pdfId: number): Promise<BookToc | null>
  /**
   * Replaces the table of contents from a `toc.json` file on disk.
   *
   * Unlike block edits this writes straight through instead of waiting for
   * Ctrl+S: the user picked a file, and a table of contents is small enough that
   * staging it in the database would only add a second copy to keep in sync.
   */
  replaceToc(pdfId: number, tocPath: string): Promise<BookToc>
  /** Removes the table of contents entry from the package. */
  clearToc(pdfId: number): Promise<void>
  replaceOcr(pdfId: number, ocrPath: string): Promise<PdfDocument>
  replaceCover(pdfId: number, coverPath: string): Promise<PdfDocument>
  remove(pdfId: number, deleteFile: boolean): void
  currentUser(): User
  getProgress(pdfId: number): ReadingProgress | null
  saveProgress(pdfId: number, lastPageNum: number): ReadingProgress
}

/**
 * Reads a `toc.json` from disk and validates it.
 *
 * Returns the raw text as well as the parsed tree: storing the text the user
 * wrote (rather than a re-serialization) keeps the package byte-for-byte
 * faithful to the file they picked. A file that does not parse is rejected here,
 * before any package is touched.
 */
async function readTocFile(tocPath: string): Promise<{ text: string; toc: BookToc }> {
  const text = await fsp.readFile(tocPath, "utf8")

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("Not a valid table of contents: the file is not JSON")
  }

  try {
    return { text, toc: parseToc(parsed) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Not a valid table of contents: ${detail}`)
  }
}

export function createLibraryService(deps: LibraryServiceDeps): LibraryService {
  const { repos } = deps

  function requireRow(pdfId: number) {
    const row = repos.documents.getById(pdfId)
    if (!row) throw new Error("PDF not found")
    return row
  }

  const service: LibraryService = {
    list: () => repos.documents.listAll(),

    get(pdfId) {
      const row = repos.documents.getById(pdfId)
      if (!row) return null
      return {
        ...toDocument(row),
        data_info: row.data_info,
        pages: repos.pages.listBriefs(pdfId),
      }
    },

    listPages: (pdfId) => repos.pages.listBriefs(pdfId),

    getPage(pdfId, pageNum) {
      const page = repos.pages.getByPageNum(pdfId, pageNum)
      if (!page) return null
      return {
        id: page.id,
        pdf_id: page.pdf_id,
        page_num: page.page_num,
        page_width: page.page_width,
        page_height: page.page_height,
        markdown_text: page.markdown_text,
        blocks: repos.blocks.listByPage(page.id),
      }
    },

    readPdfRange: (pdfId, begin, end) => readPdfRange(requireRow(pdfId).file_path, begin, end),

    updateBlock(blockId, content) {
      const block = repos.blocks.updateContent(blockId, content)
      if (!block) throw new Error("Block not found")

      const row = repos.db
        .prepare(`SELECT page_id FROM ocr_blocks WHERE id = ?`)
        .get(blockId) as { page_id: number } | undefined
      if (row) {
        const page = repos.db
          .prepare(`SELECT pdf_id FROM ocr_pages WHERE id = ?`)
          .get(row.page_id) as { pdf_id: number } | undefined
        if (page) repos.documents.setDirty(page.pdf_id, true)
      }

      return block
    },

    async scan() {
      const libraryDir = deps.getLibraryDir()
      const result: ScanResult = { added: 0, updated: 0, removed: 0, skipped: [] }

      let names: string[]
      try {
        names = await fsp.readdir(libraryDir)
      } catch {
        // An unplugged drive or a missing folder must never empty the index.
        result.skipped.push({ file: libraryDir, reason: "Library folder is not accessible" })
        return result
      }

      const present = new Set<string>()

      for (const name of names) {
        if (!name.toLowerCase().endsWith(LBOOK_EXTENSION)) continue
        const filePath = path.join(libraryDir, name)
        present.add(path.resolve(filePath))

        try {
          const outcome = await importPackage(repos, libraryDir, filePath)
          if (outcome.status === "created") result.added += 1
          else if (outcome.status === "reimported") result.updated += 1
        } catch (error) {
          result.skipped.push({
            file: name,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }

      for (const row of repos.documents.listRows()) {
        const stillThere = present.has(path.resolve(row.file_path))
        if (stillThere) continue
        // Only drop documents that lived in this library folder; a document
        // pointing elsewhere must not be removed just because it is absent here.
        if (path.resolve(path.dirname(row.file_path)) !== path.resolve(libraryDir)) continue
        await closeBook(row.file_path)
        repos.documents.remove(row.id)
        result.removed += 1
      }

      return result
    },

    async importFile(filePath) {
      const libraryDir = deps.getLibraryDir()
      const manifest = await readManifest(filePath)

      await fsp.mkdir(libraryDir, { recursive: true })
      const destination = path.join(libraryDir, packageFileName(manifest.title, manifest.uid))

      // Copy only when the package lives outside the library folder.
      if (path.resolve(filePath) !== path.resolve(destination)) {
        await fsp.copyFile(filePath, destination)
      }

      const outcome = await importPackage(repos, libraryDir, destination, { force: true })
      return repoDocument(outcome.pdfId)
    },

    async createFromFiles(input) {
      const libraryDir = deps.getLibraryDir()
      await fsp.mkdir(libraryDir, { recursive: true })

      const ocrText = await fsp.readFile(input.ocrPath, "utf8")
      let ocrData: unknown
      try {
        ocrData = JSON.parse(ocrText)
      } catch {
        throw new Error("Invalid JSON file")
      }

      const validation = validateOcrJson(ocrData)
      if (!validation.ok) {
        throw new Error(`Not a valid PaddleOCR JSON: ${validation.error}`)
      }

      // The outline is optional, and is validated before anything is written so
      // a bad file never leaves a half-built package behind.
      const tocJson = input.tocPath ? (await readTocFile(input.tocPath)).text : null

      // Page count comes from the OCR payload, matching the legacy importer.
      const parsed = parseOcrPayload(ocrData)
      const title = input.title ?? path.basename(input.pdfPath, path.extname(input.pdfPath))
      const uid = randomUUID().replace(/-/g, "")

      const outputPath = path.join(libraryDir, packageFileName(title, uid))
      await packLbook({
        pdfPath: input.pdfPath,
        ocrJson: ocrText,
        tocJson,
        coverPath: input.coverPath,
        uid,
        title,
        author: input.author ?? null,
        createdAt: nowIso(),
        pageCount: parsed.pages.length,
        outputPath,
      })

      const outcome = await importPackage(repos, libraryDir, outputPath, { force: true })
      return repoDocument(outcome.pdfId)
    },

    async save(pdfId) {
      const ocrJson = JSON.stringify(buildOcrJsonFromDb(repos, pdfId))
      await repackPackage(pdfId, { ocrJson })
      return repoDocument(pdfId)
    },

    getToc: (pdfId) => readToc(requireRow(pdfId).file_path),

    async replaceToc(pdfId, tocPath) {
      // Validated before touching the package: a rejected file must leave the
      // book exactly as it was.
      const { text, toc } = await readTocFile(tocPath)

      await repackPackage(pdfId, { tocJson: text })
      return toc
    },

    async clearToc(pdfId) {
      // Explicit null means "drop the entry", which is different from omitting
      // the key (that would mean "leave whatever is there").
      await repackPackage(pdfId, { tocJson: null })
    },

    async replaceOcr(pdfId, ocrPath) {
      const text = await fsp.readFile(ocrPath, "utf8")
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error("Invalid JSON file")
      }

      const validation = validateOcrJson(data)
      if (!validation.ok) {
        throw new Error(`Not a valid PaddleOCR JSON: ${validation.error}`)
      }

      await repackPackage(pdfId, { ocrJson: text })

      // Re-read the package so the pages table reflects the new payload.
      const row = requireRow(pdfId)
      await importPackage(repos, deps.getLibraryDir(), row.file_path, { force: true })
      return repoDocument(pdfId)
    },

    async replaceCover(pdfId, coverPath) {
      await repackPackage(pdfId, { coverPath })

      // The manifest now names a different cover entry, so refresh the index.
      const row = requireRow(pdfId)
      await importPackage(repos, deps.getLibraryDir(), row.file_path, { force: true })
      return repoDocument(pdfId)
    },

    remove(pdfId, deleteFile) {
      const row = requireRow(pdfId)
      repos.documents.remove(pdfId)
      if (deleteFile) {
        // Release the handle first; deleting an open file fails on Windows.
        void closeBook(row.file_path).then(() => fsp.rm(row.file_path, { force: true }))
      } else {
        void closeBook(row.file_path)
      }
    },

    currentUser: () => repos.users.getOrCreateAdmin(nowIso()),

    getProgress(pdfId) {
      return repos.progress.get(repos.users.getOrCreateAdmin(nowIso()).id, pdfId)
    },

    saveProgress(pdfId, lastPageNum) {
      const user = repos.users.getOrCreateAdmin(nowIso())
      const saved = repos.progress.save(user.id, pdfId, lastPageNum, nowIso())
      if (!saved) throw new Error("Page number is out of range")
      return saved
    },
  }

  function repoDocument(pdfId: number): PdfDocument {
    return toDocument(requireRow(pdfId))
  }

  /**
   * Rewrites a package in place, replacing its OCR payload, table of contents
   * and/or cover.
   *
   * The PDF is streamed verbatim out of its stored range, so saving a book never
   * re-reads or re-compresses the book itself — only the small mutable entries
   * are rebuilt.
   *
   * A repack rebuilds the whole archive, so every entry the caller does not
   * mention is read back here and written out again. Omitting that step silently
   * deletes the book's OCR, cover or table of contents.
   */
  async function repackPackage(
    pdfId: number,
    changes: { ocrJson?: string | null; tocJson?: string | null; coverPath?: string | null },
  ): Promise<void> {
    const row = requireRow(pdfId)
    const manifest = await readManifest(row.file_path)

    // Capture everything that must survive the rewrite before the handle goes.
    const dataStart = await pdfDataStart(row.file_path)
    const ocrJson = changes.ocrJson === undefined ? await readOcrText(row.file_path) : changes.ocrJson
    const tocJson = changes.tocJson === undefined ? await readTocText(row.file_path) : changes.tocJson
    const existingCover = changes.coverPath ? null : await readCover(row.file_path, manifest)

    // Windows will not rename over a file that still has an open handle, and
    // releasing it is asynchronous — this await is load-bearing.
    await closeBook(row.file_path)

    const coverEntry = changes.coverPath
      ? {
          name: `cover${path.extname(changes.coverPath).toLowerCase() || ".jpg"}`,
          mime: "image/jpeg",
        }
      : manifest.cover

    await repackLbook({
      packagePath: row.file_path,
      outputPath: row.file_path,
      pdfSize: row.file_size,
      pdfDataStart: dataStart,
      manifestFields: {
        uid: manifest.uid,
        title: manifest.title,
        author: manifest.author,
        createdAt: manifest.createdAt,
        pageCount: manifest.pageCount,
        pdfSha256: manifest.pdfSha256,
        cover: coverEntry,
      },
      ocrJson,
      tocJson,
      coverBytes:
        existingCover && manifest.cover
          ? { name: manifest.cover.name, mime: manifest.cover.mime, data: existingCover.data }
          : null,
      backgroundCover: changes.coverPath ? { sourcePath: changes.coverPath } : null,
    })

    const stats = await fsp.stat(row.file_path)
    repos.documents.updateAfterSave(pdfId, {
      file_hash: await sha256File(row.file_path),
      file_size: row.file_size,
      page_count: manifest.pageCount,
      file_mtime: stats.mtimeMs,
    })
  }

  return service
}

export { ImportSkipped }
