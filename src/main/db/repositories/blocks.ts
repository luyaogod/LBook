import type { OcrBlock } from "../../../shared/types"
import { detectHtml } from "../../lbook/ocr"
import type { Db } from "../open"

export interface BlockRow {
  id: number
  page_id: number
  block_index: number
  block_label: string
  block_content: string | null
  block_bbox: string
  block_id_external: number | null
  group_id: number | null
  block_order: number | null
  is_html_content: number
  created_at: string
}

/** block_bbox is stored as JSON text; the legacy schema did the same. */
export function parseBbox(raw: string): [number, number, number, number] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length === 4) {
      return [Number(parsed[0]), Number(parsed[1]), Number(parsed[2]), Number(parsed[3])]
    }
  } catch {
    // fall through to the empty bbox below
  }
  return [0, 0, 0, 0]
}

export function toBlock(row: BlockRow): OcrBlock {
  return {
    id: row.id,
    block_index: row.block_index,
    block_label: row.block_label,
    block_content: row.block_content,
    block_bbox: parseBbox(row.block_bbox),
    block_order: row.block_order,
    group_id: row.group_id,
  }
}

export function createBlockRepo(db: Db) {
  function getById(id: number): BlockRow | null {
    return (
      (db.prepare(`SELECT * FROM ocr_blocks WHERE id = ?`).get(id) as BlockRow | undefined) ?? null
    )
  }

  return {
    listByPage(pageId: number): OcrBlock[] {
      const rows = db
        .prepare(`SELECT * FROM ocr_blocks WHERE page_id = ? ORDER BY block_index`)
        .all(pageId) as BlockRow[]
      return rows.map(toBlock)
    },

    listRowsByPage(pageId: number): BlockRow[] {
      return db
        .prepare(`SELECT * FROM ocr_blocks WHERE page_id = ? ORDER BY block_index`)
        .all(pageId) as BlockRow[]
    },

    getById,

    /** Returns the updated block, or null when the id does not exist. */
    updateContent(id: number, content: string): OcrBlock | null {
      const result = db
        .prepare(`UPDATE ocr_blocks SET block_content = ?, is_html_content = ? WHERE id = ?`)
        .run(content, detectHtml(content), id)
      if (result.changes === 0) return null
      const row = getById(id)
      return row ? toBlock(row) : null
    },

    count(): number {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ocr_blocks`).get() as { n: number }).n
    },
  }
}

export type BlockRepo = ReturnType<typeof createBlockRepo>
