import type { OcrPageBrief } from "../../../shared/types"
import type { Db } from "../open"
import type { ParsedPage } from "../../lbook/ocr"
import { detectHtml } from "../../lbook/ocr"

export interface PageRow {
  id: number
  pdf_id: number
  page_num: number
  page_width: number | null
  page_height: number | null
  model_settings: string | null
  markdown_text: string | null
  markdown_images: string | null
  pruned_result: string | null
  created_at: string
}

export function createPageRepo(db: Db) {
  const insertPage = db.prepare(
    `INSERT INTO ocr_pages
       (pdf_id, page_num, page_width, page_height, model_settings,
        markdown_text, markdown_images, pruned_result, created_at)
     VALUES
       (@pdf_id, @page_num, @page_width, @page_height, @model_settings,
        @markdown_text, @markdown_images, @pruned_result, @created_at)`,
  )

  const insertBlock = db.prepare(
    `INSERT INTO ocr_blocks
       (page_id, block_index, block_label, block_content, block_bbox,
        block_id_external, group_id, block_order, is_html_content, created_at)
     VALUES
       (@page_id, @block_index, @block_label, @block_content, @block_bbox,
        @block_id_external, @group_id, @block_order, @is_html_content, @created_at)`,
  )

  return {
    listBriefs(pdfId: number): OcrPageBrief[] {
      return db
        .prepare(
          `SELECT id, page_num, page_width, page_height
             FROM ocr_pages WHERE pdf_id = ? ORDER BY page_num`,
        )
        .all(pdfId) as OcrPageBrief[]
    },

    getByPageNum(pdfId: number, pageNum: number): PageRow | null {
      return (db
        .prepare(`SELECT * FROM ocr_pages WHERE pdf_id = ? AND page_num = ?`)
        .get(pdfId, pageNum) as PageRow | undefined) ?? null
    },

    listRowsByPdf(pdfId: number): PageRow[] {
      return db
        .prepare(`SELECT * FROM ocr_pages WHERE pdf_id = ? ORDER BY page_num`)
        .all(pdfId) as PageRow[]
    },

    /** Writes one parsed page plus its blocks. Returns the new page id. */
    insertPageWithBlocks(pdfId: number, page: ParsedPage, createdAt: string): number {
      const result = insertPage.run({
        pdf_id: pdfId,
        page_num: page.page_num,
        page_width: page.page_width,
        page_height: page.page_height,
        model_settings: page.model_settings,
        markdown_text: page.markdown_text,
        markdown_images: page.markdown_images,
        pruned_result: page.pruned_result,
        created_at: createdAt,
      })
      const pageId = Number(result.lastInsertRowid)

      for (const [index, block] of page.blocks.entries()) {
        insertBlock.run({
          page_id: pageId,
          block_index: index,
          block_label: block.block_label,
          block_content: block.block_content,
          block_bbox: JSON.stringify(block.block_bbox ?? []),
          block_id_external: block.block_id,
          group_id: block.group_id,
          block_order: block.block_order,
          is_html_content: detectHtml(block.block_content),
          created_at: createdAt,
        })
      }

      return pageId
    },

    removeByPdf(pdfId: number): void {
      // Blocks cascade from ocr_pages.
      db.prepare(`DELETE FROM ocr_pages WHERE pdf_id = ?`).run(pdfId)
    },

    count(): number {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ocr_pages`).get() as { n: number }).n
    },
  }
}

export type PageRepo = ReturnType<typeof createPageRepo>
