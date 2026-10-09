import { promises as fsp } from "node:fs"
import path from "node:path"
import { nowIso, type Repositories } from "../db"
import { parseOcrPayload } from "../lbook/ocr"
import { pdfSize, readOcrJson } from "../lbook/reader"
import { validateLbook } from "../lbook/validate"
import { sha256File } from "./hash"

export type ImportStatus = "created" | "reimported" | "unchanged"

export interface ImportOutcome {
  pdfId: number
  status: ImportStatus
}

export class ImportSkipped extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = "ImportSkipped"
    this.reason = reason
  }
}

/**
 * Indexes a .lbook package into the database.
 *
 * Cheap when nothing changed: the manifest and the container mtime are enough to
 * decide, so a library scan does not re-parse thousands of OCR blocks every time.
 * Re-importing is refused while the document has unsaved edits, because it would
 * silently discard them.
 */
export async function importPackage(
  repos: Repositories,
  libraryDir: string,
  filePath: string,
  options: { force?: boolean } = {},
): Promise<ImportOutcome> {
  const validation = await validateLbook(filePath)
  if (!validation.ok || !validation.manifest) {
    const detail = validation.errors.map((error) => error.message).join("; ")
    throw new ImportSkipped(detail || "Not a valid .lbook package")
  }
  const manifest = validation.manifest

  const stats = await fsp.stat(filePath)
  const existing = repos.documents.getByUid(manifest.uid)

  if (existing && !options.force) {
    if (existing.file_mtime === stats.mtimeMs && existing.file_path === filePath) {
      return { pdfId: existing.id, status: "unchanged" }
    }
    if (existing.dirty !== 0) {
      throw new ImportSkipped(
        `"${existing.file_name}" has unsaved edits in the app; save or discard them before reimporting`,
      )
    }
  }

  // Everything async happens before the transaction: better-sqlite3 is sync.
  const [ocrPayload, storedPdfSize, fileHash] = await Promise.all([
    readOcrJson(filePath),
    pdfSize(filePath),
    sha256File(filePath),
  ])
  const parsed = ocrPayload === null ? null : parseOcrPayload(ocrPayload)

  const now = nowIso()
  const relativePath = path.relative(libraryDir, filePath)

  const run = repos.db.transaction((): number => {
    let pdfId: number

    if (existing) {
      repos.pages.removeByPdf(existing.id)
      repos.documents.updateAfterSave(existing.id, {
        file_hash: fileHash,
        file_size: storedPdfSize,
        page_count: parsed?.pages.length ?? manifest.pageCount,
        file_mtime: stats.mtimeMs,
      })
      repos.documents.updateLocation(existing.id, { file_path: filePath, relative_path: relativePath })
      repos.db
        .prepare(
          `UPDATE pdf_documents SET file_name = ?, author = ?, data_info = ?, created_at = ? WHERE id = ?`,
        )
        .run(manifest.title, manifest.author, parsed?.data_info ?? null, manifest.createdAt, existing.id)
      pdfId = existing.id
    } else {
      pdfId = repos.documents.insert({
        uid: manifest.uid,
        file_name: manifest.title,
        author: manifest.author,
        file_path: filePath,
        relative_path: relativePath,
        file_hash: fileHash,
        page_count: parsed?.pages.length ?? manifest.pageCount,
        file_size: storedPdfSize,
        file_mtime: stats.mtimeMs,
        data_info: parsed?.data_info ?? null,
        cover_path: manifest.cover ? manifest.cover.name : null,
        created_at: manifest.createdAt,
      })
    }

    if (parsed) {
      for (const page of parsed.pages) {
        repos.pages.insertPageWithBlocks(pdfId, page, now)
      }
    }

    return pdfId
  })

  return { pdfId: run(), status: existing ? "reimported" : "created" }
}
