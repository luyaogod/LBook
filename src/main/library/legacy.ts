import type Database from "better-sqlite3"
import type { BlockRow } from "../db/repositories/blocks"
import { mergeBlocks } from "../lbook/reconstruct"

/**
 * Reads the pre-Electron `backend/lbook.db`.
 *
 * The legacy schema has no `uid`, `relative_path`, `dirty`, `file_mtime` or
 * `author` columns, so it cannot be read through the repositories — those
 * SELECT every column by name. Everything here is raw SQL against a database
 * that must be opened READ-ONLY.
 */

export interface LegacyDocument {
  id: number
  file_name: string
  file_path: string
  file_hash: string
  page_count: number
  file_size: number
  data_info: string | null
  cover_path: string | null
  created_at: string
}

export interface LegacyPage {
  id: number
  page_num: number
  markdown_text: string | null
  markdown_images: string | null
  pruned_result: string | null
}

export interface LegacyProgress {
  pdf_id: number
  last_page_num: number
  updated_at: string
}

export interface ReconstructedBook {
  /** Serialized PaddleOCR payload, ready to be written as ocr.json. */
  json: string
  layoutParsingResults: unknown[]
  dataInfo: unknown
  pages: number
  blocks: number
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function readLegacyDocuments(db: Database.Database): LegacyDocument[] {
  return db.prepare(`SELECT * FROM pdf_documents ORDER BY id`).all() as LegacyDocument[]
}

export function readLegacyProgress(db: Database.Database): LegacyProgress[] {
  return db
    .prepare(`SELECT pdf_id, last_page_num, updated_at FROM reading_progress`)
    .all() as LegacyProgress[]
}

/**
 * Rebuilds one book's PaddleOCR payload.
 *
 * Block content is merged from `ocr_blocks` over `pruned_result`, because user
 * edits exist only in the former (doc #3 has five) while per-block keys the
 * database has no column for exist only in the latter.
 */
export function reconstructLegacyBook(
  db: Database.Database,
  doc: LegacyDocument,
): ReconstructedBook {
  const pages = db
    .prepare(
      `SELECT id, page_num, markdown_text, markdown_images, pruned_result
         FROM ocr_pages WHERE pdf_id = ? ORDER BY page_num`,
    )
    .all(doc.id) as LegacyPage[]

  const readBlocks = db.prepare(`SELECT * FROM ocr_blocks WHERE page_id = ? ORDER BY block_index`)

  let blockCount = 0

  const layoutParsingResults = pages.map((page) => {
    const pruned = parseJson<Record<string, unknown>>(page.pruned_result, {})
    const originalBlocks = Array.isArray(pruned.parsing_res_list)
      ? (pruned.parsing_res_list as Record<string, unknown>[])
      : []

    // The legacy table has exactly the column names BlockRow expects.
    const rows = readBlocks.all(page.id) as BlockRow[]
    blockCount += rows.length

    pruned.parsing_res_list = mergeBlocks(originalBlocks, rows)

    return {
      prunedResult: pruned,
      markdown: {
        text: page.markdown_text,
        images: parseJson<Record<string, unknown>>(page.markdown_images, {}),
      },
    }
  })

  const dataInfo = parseJson<unknown>(doc.data_info, {})

  return {
    json: JSON.stringify({ layoutParsingResults, dataInfo }),
    layoutParsingResults,
    dataInfo,
    pages: pages.length,
    blocks: blockCount,
  }
}
