import type { ReadingProgress } from "../../../shared/types"
import type { Db } from "../open"

export function createProgressRepo(db: Db) {
  function get(userId: number, pdfId: number): ReadingProgress | null {
    return (
      (db
        .prepare(
          `SELECT id, user_id, pdf_id, last_page_num, updated_at
             FROM reading_progress WHERE user_id = ? AND pdf_id = ?`,
        )
        .get(userId, pdfId) as ReadingProgress | undefined) ?? null
    )
  }

  return {
    get,

    /**
     * Upsert. Returns null when the page is outside 1..pdf.page_count, which the
     * legacy API surfaced as HTTP 422.
     */
    save(userId: number, pdfId: number, lastPageNum: number, updatedAt: string): ReadingProgress | null {
      const doc = db
        .prepare(`SELECT page_count FROM pdf_documents WHERE id = ?`)
        .get(pdfId) as { page_count: number } | undefined
      if (!doc) throw new Error("PDF not found")
      if (lastPageNum < 1 || lastPageNum > doc.page_count) return null

      db.prepare(
        `INSERT INTO reading_progress (user_id, pdf_id, last_page_num, updated_at)
         VALUES (@user_id, @pdf_id, @last_page_num, @updated_at)
         ON CONFLICT (user_id, pdf_id)
         DO UPDATE SET last_page_num = excluded.last_page_num, updated_at = excluded.updated_at`,
      ).run({ user_id: userId, pdf_id: pdfId, last_page_num: lastPageNum, updated_at: updatedAt })

      return get(userId, pdfId)
    },

    removeByPdf(pdfId: number): void {
      db.prepare(`DELETE FROM reading_progress WHERE pdf_id = ?`).run(pdfId)
    },
  }
}

export type ProgressRepo = ReturnType<typeof createProgressRepo>
