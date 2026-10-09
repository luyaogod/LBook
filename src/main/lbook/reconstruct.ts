import type { Repositories } from "../db"
import type { BlockRow } from "../db/repositories/blocks"

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Fallback shape when a block exists in the DB but not in the original payload. */
function blockRowToObject(row: BlockRow): Record<string, unknown> {
  return {
    block_label: row.block_label,
    block_content: row.block_content,
    block_bbox: parseJson<unknown>(row.block_bbox, []),
    block_id: row.block_id_external,
    group_id: row.group_id,
    block_order: row.block_order,
  }
}

/**
 * Merges the original block objects with the current database rows.
 *
 * Both sources are required, and neither alone is correct:
 *   - `pruned_result` keeps each block object verbatim, including keys the
 *     database has no column for (global_block_id, global_group_id,
 *     block_polygon_points) as well as layout_det_res.
 *   - `ocr_blocks` holds the current content, which may carry user edits.
 *
 * Rebuilding from `pruned_result` alone silently reverts edits — doc #3 has five
 * of them on pages 22 and 24. Rebuilding from `ocr_blocks` alone drops the three
 * unmodelled keys. Hence the merge.
 */
export function mergeBlocks(
  originalBlocks: Record<string, unknown>[],
  rows: BlockRow[],
): Record<string, unknown>[] {
  const byIndex = new Map(rows.map((row) => [row.block_index, row]))
  const highestRowIndex = rows.reduce((max, row) => Math.max(max, row.block_index + 1), 0)
  const count = Math.max(originalBlocks.length, highestRowIndex)

  const merged: Record<string, unknown>[] = []
  for (let index = 0; index < count; index++) {
    const base = originalBlocks[index]
    const row = byIndex.get(index)

    if (base && row) {
      merged.push({ ...base, block_label: row.block_label, block_content: row.block_content })
    } else if (base) {
      merged.push(base)
    } else if (row) {
      merged.push(blockRowToObject(row))
    }
  }
  return merged
}

/**
 * Rebuilds the PaddleOCR payload for a document from the database.
 *
 * Used by both the legacy migration and "save", so the two can never drift.
 */
export function buildOcrJsonFromDb(repos: Repositories, pdfId: number): unknown {
  const doc = repos.documents.getById(pdfId)
  if (!doc) throw new Error(`Document ${pdfId} not found`)

  const dataInfo = parseJson<unknown>(doc.data_info, {})

  const layoutParsingResults = repos.pages.listRowsByPdf(pdfId).map((page) => {
    const pruned = parseJson<Record<string, unknown>>(page.pruned_result, {})
    const originalBlocks = Array.isArray(pruned.parsing_res_list)
      ? (pruned.parsing_res_list as Record<string, unknown>[])
      : []

    pruned.parsing_res_list = mergeBlocks(originalBlocks, repos.blocks.listRowsByPage(page.id))

    return {
      prunedResult: pruned,
      markdown: {
        text: page.markdown_text,
        images: parseJson<Record<string, unknown>>(page.markdown_images, {}),
      },
    }
  })

  return { layoutParsingResults, dataInfo }
}
