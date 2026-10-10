import type { OcrBlock, OcrPage } from "../../shared/types"

/**
 * One page element of a PaddleOCR JSON, mapped to the shape the renderer reads.
 *
 * This is the whole of the old `ocr.ts` that survived: the parse-into-SQLite
 * halves (`normalizeOcrJson`, `parseOcrPayload`) went with the database, and what
 * is left is the field mapping — `prunedResult.parsing_res_list` into blocks,
 * `markdown.text` into `markdown_text`, `prunedResult.width/height` into the page
 * size.
 *
 * Nothing here is derived from anything else, on purpose (A10): the Markdown view
 * and the Blocks view are two readings of the *same* file, and building one out
 * of the other would invent a relationship PaddleOCR does not promise.
 *
 * Field names in the input are PaddleOCR's (`block_bbox`, `block_label`, …); the
 * output uses the same names so a reader comparing the JSON with the sidebar sees
 * the same words.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

/** One raw `parsing_res_list` entry as the renderer's block shape. */
export function toOcrBlock(raw: unknown, index: number): OcrBlock {
  const block = asRecord(raw)
  const bbox = block.block_bbox
  return {
    block_index: index,
    block_label: toNullableString(block.block_label) ?? "unknown",
    block_content: toNullableString(block.block_content),
    // The JSON already carries the box as an array; the old database stored it as
    // text and every read paid a `JSON.parse`, which this shape does not need.
    block_bbox:
      Array.isArray(bbox) && bbox.length === 4
        ? (bbox.map((n) => Number(n)) as [number, number, number, number])
        : [0, 0, 0, 0],
    block_order: toNullableInt(block.block_order),
    group_id: toNullableInt(block.group_id),
  }
}

export function toOcrBlocks(raw: unknown): OcrBlock[] {
  return (Array.isArray(raw) ? raw : []).map(toOcrBlock)
}

/**
 * The page size, which the viewer needs to scale OCR boxes onto the rendered PDF.
 *
 * `prunedResult.width/height` is normally there; when it is not, the largest
 * bottom-right corner among the blocks is the best available answer. Both are
 * nullable, and the viewer copes with null by not drawing overlays.
 */
export function pageSizeOf(pruned: Record<string, unknown>, blocks: OcrBlock[]): {
  width: number | null
  height: number | null
} {
  let width = toNullableInt(pruned.width)
  let height = toNullableInt(pruned.height)
  if (width === null || height === null) {
    // "Nothing to measure" stays null rather than becoming 0: the viewer treats
    // both as "draw no overlay", and a number that means "unknown" invites a
    // division by it later.
    const maxX = blocks.reduce((max, block) => Math.max(max, block.block_bbox[2]), 0)
    const maxY = blocks.reduce((max, block) => Math.max(max, block.block_bbox[3]), 0)
    if (width === null) width = maxX > 0 ? maxX : null
    if (height === null) height = maxY > 0 ? maxY : null
  }
  return { width, height }
}

/**
 * Maps one page element of the OCR JSON.
 *
 * `element` is what `readSpanAt` parsed out of the file: `{ prunedResult,
 * markdown }` (PaddleOCR's own shape, either wrapped or bare). Anything missing
 * inside it becomes an empty page rather than an error — a page PaddleOCR left
 * half-written is still a page the reader can turn past.
 */
export function toOcrPage(element: unknown, pageNum: number, uid: string): OcrPage {
  const page = asRecord(element)
  const pruned = asRecord(page.prunedResult)
  const markdown = asRecord(page.markdown)
  const blocks = toOcrBlocks(pruned.parsing_res_list)
  const size = pageSizeOf(pruned, blocks)

  return {
    uid,
    page_num: pageNum,
    page_width: size.width,
    page_height: size.height,
    markdown_text: toNullableString(markdown.text),
    blocks,
  }
}
