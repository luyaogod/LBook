/**
 * PaddleOCR-VL JSON handling — a direct port of the legacy
 * `backend/import_utils.py` so previously imported books reconstruct identically.
 *
 * Supports two input shapes:
 *   1. Wrapped: { "layoutParsingResults": [{ prunedResult, markdown }, ...], "dataInfo": {...} }
 *   2. Array:   [{ prunedResult, markdown }, ...]
 */

export interface ParsedBlock {
  block_label: string
  block_content: string | null
  block_bbox: [number, number, number, number] | null
  block_id: number | null
  group_id: number | null
  block_order: number | null
}

export interface ParsedPage {
  page_num: number
  page_width: number | null
  page_height: number | null
  model_settings: string | null
  markdown_text: string | null
  markdown_images: string | null
  pruned_result: string
  blocks: ParsedBlock[]
}

export interface ParsedOcr {
  data_info: string
  pages: ParsedPage[]
}

/** Returns 1 when the content looks like HTML, 0 otherwise. */
export function detectHtml(content: string | null | undefined): number {
  if (!content) return 0
  return ["<div", "<img", "<table", "<span"].some((tag) => content.includes(tag)) ? 1 : 0
}

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

/** Normalizes both accepted shapes to (pageResults, dataInfo). Throws on bad input. */
export function normalizeOcrJson(data: unknown): { pageResults: unknown[]; dataInfo: unknown } {
  if (Array.isArray(data)) {
    if (data.length === 0) throw new Error("OCR JSON array is empty")
    data.forEach((page, i) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) {
        throw new Error(`Page ${i + 1} must be an object`)
      }
      if (!("prunedResult" in (page as Record<string, unknown>))) {
        throw new Error(`Page ${i + 1} missing required field: prunedResult`)
      }
    })
    return { pageResults: data, dataInfo: { type: "pdf", numPages: data.length, pages: [] } }
  }

  if (!data || typeof data !== "object") {
    throw new Error("JSON must be an object or array")
  }

  const record = data as Record<string, unknown>
  const results = record.layoutParsingResults
  if (results === undefined) throw new Error("Missing required field: layoutParsingResults")
  if (!Array.isArray(results)) throw new Error("layoutParsingResults must be an array")
  if (results.length === 0) throw new Error("layoutParsingResults is empty")

  const dataInfo = record.dataInfo ?? {}
  if (typeof dataInfo !== "object" || Array.isArray(dataInfo)) {
    throw new Error("dataInfo must be an object")
  }

  return { pageResults: results, dataInfo }
}

/** Validates without consuming; mirrors the legacy `validate_ocr_json`. */
export function validateOcrJson(data: unknown): { ok: true } | { ok: false; error: string } {
  try {
    normalizeOcrJson(data)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function parsePage(pageResult: unknown, index: number): ParsedPage {
  const page = asRecord(pageResult)
  const pruned = asRecord(page.prunedResult)
  const markdown = asRecord(page.markdown)

  const parsingList = Array.isArray(pruned.parsing_res_list) ? pruned.parsing_res_list : []

  let pageWidth = toNullableInt(pruned.width)
  let pageHeight = toNullableInt(pruned.height)
  if ((pageWidth === null || pageHeight === null) && parsingList.length > 0) {
    const maxX = Math.max(
      ...parsingList.map((b) => {
        const bbox = asRecord(b).block_bbox
        return Array.isArray(bbox) && typeof bbox[2] === "number" ? bbox[2] : 0
      }),
      0,
    )
    const maxY = Math.max(
      ...parsingList.map((b) => {
        const bbox = asRecord(b).block_bbox
        return Array.isArray(bbox) && typeof bbox[3] === "number" ? bbox[3] : 0
      }),
      0,
    )
    if (pageWidth === null) pageWidth = maxX
    if (pageHeight === null) pageHeight = maxY
  }

  const modelSettings = pruned.model_settings
  const markdownImages = markdown.images

  return {
    page_num: index + 1,
    page_width: pageWidth,
    page_height: pageHeight,
    model_settings: modelSettings ? JSON.stringify(modelSettings) : null,
    markdown_text: toNullableString(markdown.text),
    markdown_images: markdownImages ? JSON.stringify(markdownImages) : null,
    pruned_result: JSON.stringify(pruned),
    blocks: parsingList.map((raw) => {
      const block = asRecord(raw)
      const bbox = block.block_bbox
      return {
        block_label: toNullableString(block.block_label) ?? "unknown",
        block_content: toNullableString(block.block_content),
        block_bbox:
          Array.isArray(bbox) && bbox.length === 4
            ? (bbox.map((n) => Number(n)) as [number, number, number, number])
            : null,
        block_id: toNullableInt(block.block_id),
        group_id: toNullableInt(block.group_id),
        block_order: toNullableInt(block.block_order),
      }
    }),
  }
}

/** Parses a PaddleOCR payload into the shape the repositories insert. */
export function parseOcrPayload(data: unknown): ParsedOcr {
  const { pageResults, dataInfo } = normalizeOcrJson(data)
  return {
    data_info: JSON.stringify(dataInfo),
    pages: pageResults.map(parsePage),
  }
}
