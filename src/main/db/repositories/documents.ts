import type { PdfDocument } from "../../../shared/types"
import { coverUrl } from "../../../shared/urls"
import type { Db } from "../open"

export interface DocumentRow {
  id: number
  uid: string
  file_name: string
  author: string | null
  file_path: string
  relative_path: string
  file_hash: string
  page_count: number
  file_size: number
  file_mtime: number
  data_info: string | null
  cover_path: string | null
  status: string
  dirty: number
  created_at: string
}

export interface NewDocument {
  uid: string
  file_name: string
  author: string | null
  file_path: string
  relative_path: string
  file_hash: string
  page_count: number
  file_size: number
  file_mtime: number
  data_info: string | null
  cover_path: string | null
  status?: string
  created_at: string
}

const COLUMNS = `id, uid, file_name, author, file_path, relative_path, file_hash,
  page_count, file_size, file_mtime, data_info, cover_path, status, dirty, created_at`

export function toDocument(row: DocumentRow): PdfDocument {
  return {
    id: row.id,
    uid: row.uid,
    title: row.file_name,
    author: row.author,
    page_count: row.page_count,
    file_size: row.file_size,
    status: row.status,
    cover_url: row.cover_path ? coverUrl(row.uid) : null,
    created_at: row.created_at,
    dirty: row.dirty !== 0,
  }
}

export function createDocumentRepo(db: Db) {
  return {
    listAll(): PdfDocument[] {
      const rows = db
        .prepare(`SELECT ${COLUMNS} FROM pdf_documents ORDER BY created_at DESC, id DESC`)
        .all() as DocumentRow[]
      return rows.map(toDocument)
    },

    /** Raw rows, for callers that need columns the renderer shape drops. */
    listRows(): DocumentRow[] {
      return db
        .prepare(`SELECT ${COLUMNS} FROM pdf_documents ORDER BY created_at DESC, id DESC`)
        .all() as DocumentRow[]
    },

    getById(id: number): DocumentRow | null {
      return (db.prepare(`SELECT ${COLUMNS} FROM pdf_documents WHERE id = ?`).get(id) as
        | DocumentRow
        | undefined) ?? null
    },

    getByUid(uid: string): DocumentRow | null {
      return (db.prepare(`SELECT ${COLUMNS} FROM pdf_documents WHERE uid = ?`).get(uid) as
        | DocumentRow
        | undefined) ?? null
    },

    getByHash(fileHash: string): DocumentRow | null {
      return (db
        .prepare(`SELECT ${COLUMNS} FROM pdf_documents WHERE file_hash = ?`)
        .get(fileHash) as DocumentRow | undefined) ?? null
    },

    insert(doc: NewDocument): number {
      const result = db
        .prepare(
          `INSERT INTO pdf_documents
             (uid, file_name, author, file_path, relative_path, file_hash,
              page_count, file_size, file_mtime, data_info, cover_path, status, dirty, created_at)
           VALUES
             (@uid, @file_name, @author, @file_path, @relative_path, @file_hash,
              @page_count, @file_size, @file_mtime, @data_info, @cover_path, @status, 0, @created_at)`,
        )
        .run({ ...doc, status: doc.status ?? "completed" })
      return Number(result.lastInsertRowid)
    },

    setDirty(id: number, dirty: boolean): void {
      db.prepare(`UPDATE pdf_documents SET dirty = ? WHERE id = ?`).run(dirty ? 1 : 0, id)
    },

    setCoverPath(id: number, coverPath: string | null): void {
      db.prepare(`UPDATE pdf_documents SET cover_path = ? WHERE id = ?`).run(coverPath, id)
    },

    /** Fields that change when the working copy is written back into the .lbook. */
    updateAfterSave(
      id: number,
      fields: { file_hash: string; file_size: number; page_count: number; file_mtime: number },
    ): void {
      db.prepare(
        `UPDATE pdf_documents
            SET file_hash = @file_hash, file_size = @file_size,
                page_count = @page_count, file_mtime = @file_mtime, dirty = 0
          WHERE id = @id`,
      ).run({ ...fields, id })
    },

    /** Refreshes just the container fingerprint after an external change. */
    setFileStat(id: number, fields: { file_hash: string; file_mtime: number }): void {
      db.prepare(
        `UPDATE pdf_documents SET file_hash = @file_hash, file_mtime = @file_mtime WHERE id = @id`,
      ).run({ ...fields, id })
    },

    updateLocation(id: number, location: { file_path: string; relative_path: string }): void {
      db.prepare(
        `UPDATE pdf_documents SET file_path = @file_path, relative_path = @relative_path WHERE id = @id`,
      ).run({ ...location, id })
    },

    remove(id: number): void {
      // Pages and blocks go with it via ON DELETE CASCADE (requires foreign_keys = ON).
      db.prepare(`DELETE FROM pdf_documents WHERE id = ?`).run(id)
    },

    count(): number {
      return (db.prepare(`SELECT COUNT(*) AS n FROM pdf_documents`).get() as { n: number }).n
    },
  }
}

export type DocumentRepo = ReturnType<typeof createDocumentRepo>
