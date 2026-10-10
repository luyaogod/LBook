import { describe, expect, it } from "vitest"
import { pageSizeOf, toOcrBlock, toOcrBlocks, toOcrPage } from "../../../src/main/lbook/ocr"

/**
 * The page mapper is the only thing that stands between PaddleOCR's JSON and the
 * renderer's shape, so these pin the field names the sidebar and the viewer read.
 */

describe("toOcrBlock", () => {
  it("keeps PaddleOCR's field names and copies the bbox as an array", () => {
    const block = toOcrBlock(
      {
        block_label: "table",
        block_content: "<table></table>",
        block_bbox: [1, 2, 3, 4],
        block_order: 7,
        group_id: 2,
      },
      5,
    )

    expect(block).toEqual({
      block_index: 5,
      block_label: "table",
      block_content: "<table></table>",
      block_bbox: [1, 2, 3, 4],
      block_order: 7,
      group_id: 2,
    })
  })

  it("fills in what a half-written block is missing instead of throwing", () => {
    const block = toOcrBlock({}, 0)
    expect(block.block_label).toBe("unknown")
    expect(block.block_content).toBeNull()
    expect(block.block_bbox).toEqual([0, 0, 0, 0])
    expect(block.block_order).toBeNull()
  })

  it("number-equals text labels: the index is the block's identity", () => {
    // Hover and scroll wiring compares `block_index` within a page, so it must be
    // the array position and nothing else.
    const blocks = toOcrBlocks([{}, {}, {}])
    expect(blocks.map((b) => b.block_index)).toEqual([0, 1, 2])
  })

  it("treats a non-array parsing_res_list as no blocks", () => {
    expect(toOcrBlocks(undefined)).toEqual([])
    expect(toOcrBlocks("nope")).toEqual([])
  })
})

describe("pageSizeOf", () => {
  it("uses prunedResult's width and height when they are there", () => {
    expect(pageSizeOf({ width: 1000, height: 2000 }, [])).toEqual({ width: 1000, height: 2000 })
  })

  it("falls back to the largest bottom-right corner of the blocks", () => {
    const blocks = toOcrBlocks([
      { block_bbox: [0, 0, 120, 40] },
      { block_bbox: [10, 50, 300, 90] },
    ])
    expect(pageSizeOf({}, blocks)).toEqual({ width: 300, height: 90 })
  })

  it("keeps an unmeasurable size null rather than zero", () => {
    // null and 0 both mean "no overlay" to the viewer; null cannot be divided by.
    expect(pageSizeOf({}, [])).toEqual({ width: null, height: null })
    expect(pageSizeOf({ width: 800 }, [])).toEqual({ width: 800, height: null })
  })
})

describe("toOcrPage", () => {
  it("reads markdown.text and parsing_res_list as two separate answers (A10)", () => {
    const page = toOcrPage(
      {
        prunedResult: {
          width: 1224,
          height: 1584,
          parsing_res_list: [{ block_label: "text", block_content: "hello" }],
        },
        markdown: { text: "# Hello", images: {} },
      },
      7,
      "uid-1",
    )

    expect(page.uid).toBe("uid-1")
    expect(page.page_num).toBe(7)
    expect(page.page_width).toBe(1224)
    expect(page.page_height).toBe(1584)
    // Verbatim, not rebuilt from the blocks: the two views do not derive from each
    // other, so a block edit in the file does not silently rewrite the Markdown.
    expect(page.markdown_text).toBe("# Hello")
    expect(page.blocks).toHaveLength(1)
    expect(page.blocks[0].block_content).toBe("hello")
  })

  it("survives an element that is not an object at all", () => {
    const page = toOcrPage(null, 1, "uid-1")
    expect(page.markdown_text).toBeNull()
    expect(page.blocks).toEqual([])
    expect(page.page_width).toBeNull()
  })
})
