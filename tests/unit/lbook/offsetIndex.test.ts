import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readSpan, readSpanAt, scanPageSpans } from "../../../src/main/lbook/offsetIndex"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** Writes a temporary JSON file; every call in this file shares one temp folder. */
function tempJson(text: string): string {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-offset-"))
  const file = path.join(dir, `sample-${String(Math.random()).slice(2)}.json`)
  fs.writeFileSync(file, text, "utf8")
  return file
}

/** Builds a JSON document in PaddleOCR's shape (two-space indent, like the real thing). */
function ocrJson(pages: unknown[]): string {
  return JSON.stringify({ dataInfo: { type: "ppstructurev3" }, layoutParsingResults: pages }, null, 2)
}

function page(n: number, content = `第 ${n} 页的正文`): unknown {
  return {
    prunedResult: {
      width: 1224,
      height: 1584,
      parsing_res_list: [{ block_label: "text", block_content: content, block_bbox: [10, 20, 30, 40] }],
    },
    markdown: { text: `### 页 ${n}\n\n${content}`, images: {} },
  }
}

describe("offsetIndex", () => {
  it("returns a span per element, and each span parses back to that element", async () => {
    const pages = [page(1), page(2), page(3), page(4), page(5)]
    const file = tempJson(ocrJson(pages))

    const { spans, fileBytes, scannedBytes } = await scanPageSpans(file)
    expect(spans).toHaveLength(pages.length)
    expect(scannedBytes).toBe(fileBytes)

    for (let n = 0; n < pages.length; n++) {
      expect(readSpan(file, spans[n])).toEqual(pages[n])
    }
  })

  it("is byte-based, so chunk boundaries can fall anywhere", async () => {
    // Chunk sizes of 7 / 13 / 64 bytes land inside quotes, commas and even escape
    // sequences. If the state machine needed a carry buffer across chunks, one of
    // these sizes would fail.
    const pages = [page(1), page(2), page(3)]
    const file = tempJson(ocrJson(pages))

    for (const chunkBytes of [7, 13, 64, 4096]) {
      const { spans } = await scanPageSpans(file, { chunkBytes })
      expect(spans, `chunkBytes=${chunkBytes}`).toHaveLength(pages.length)
      for (let n = 0; n < pages.length; n++) {
        expect(readSpan(file, spans[n]), `chunkBytes=${chunkBytes} page ${n}`).toEqual(pages[n])
      }
    }
  })

  it("does not mistake braces and quotes inside strings for structure", async () => {
    const nasty = '{"a":[1,2]} }{" 反斜杠:\\\\ 转义引号:\\" 收尾:{ '
    const file = tempJson(
      ocrJson([
        {
          prunedResult: {
            parsing_res_list: [
              { block_label: "table", block_content: nasty, block_bbox: [1, 2, 3, 4] },
              { block_label: "text", block_content: "", block_bbox: [0, 0, 0, 0] },
            ],
          },
          markdown: { text: nasty },
        },
        page(2),
      ]),
    )

    const { spans } = await scanPageSpans(file, { chunkBytes: 11 })
    expect(spans).toHaveLength(2)
    const first = readSpan(file, spans[0]) as { markdown: { text: string } }
    expect(first.markdown.text).toBe(nasty)
  })

  it("does not care where multi-byte characters fall", async () => {
    // A 5-byte chunk is guaranteed to split a Chinese character or an emoji in half.
    // Inside a string only `"` and `\` matter, and both are single bytes, so the
    // split changes nothing.
    const content = "中文内容 🀄 emoji 😀 与拉丁 Latin"
    const file = tempJson(ocrJson([page(1, content), page(2, content), page(3, content)]))

    const { spans } = await scanPageSpans(file, { chunkBytes: 5 })
    expect(spans).toHaveLength(3)
    const first = readSpan(file, spans[0]) as { prunedResult: { parsing_res_list: Array<{ block_content: string }> } }
    expect(first.prunedResult.parsing_res_list[0].block_content).toBe(content)
  })

  it("stops reading once the limit is reached", async () => {
    // The file has to be clearly larger than "the prefix (64KB) plus one chunk (1MB)"
    // for this assertion to mean anything: this is the 8–40MB OCR JSON of real life.
    const pages = Array.from({ length: 1500 }, (_, i) => page(i + 1, `第 ${i + 1} 页 `.repeat(40)))
    const file = tempJson(ocrJson(pages))

    const { spans, fileBytes, scannedBytes } = await scanPageSpans(file, { limit: 30 })
    expect(spans).toHaveLength(30)
    expect(fileBytes).toBeGreaterThan(2 * 1024 * 1024)
    // The unit of work is "prefix plus one chunk", so it only saves much on a large
    // file; the measured first screen for 15.6MB / 294 pages was 6.9ms (baseline.md).
    expect(scannedBytes).toBeLessThan(fileBytes / 2)
  })

  it("finds the array even when it sits far from the start of the file", async () => {
    const filler = "x".repeat(2 * 1024 * 1024)
    const file = tempJson(
      JSON.stringify({ dataInfo: { note: filler }, layoutParsingResults: [page(1), page(2)] }, null, 2),
    )

    const { spans } = await scanPageSpans(file)
    expect(spans).toHaveLength(2)
    expect(readSpan(file, spans[1])).toEqual(page(2))
  })

  it("returns nothing instead of throwing when the array is missing or empty", async () => {
    const missing = tempJson(JSON.stringify({ dataInfo: {} }))
    expect((await scanPageSpans(missing)).spans).toEqual([])

    const empty = tempJson(ocrJson([]))
    expect((await scanPageSpans(empty)).spans).toEqual([])
  })

  it("keeps the pages it could read when the file is truncated", async () => {
    const text = ocrJson([page(1), page(2), page(3)])
    // Truncated in the middle of page 3: the first two pages are whole, and page 3
    // must not be pretended into existence.
    const file = tempJson(text.slice(0, Math.floor(text.length * 0.8)))

    const { spans } = await scanPageSpans(file)
    expect(spans).toHaveLength(2)

    // And the spans found so far still parse on their own, which is what lets a caller
    // show the first two pages and report the third.
    const fd = fs.openSync(file, "r")
    try {
      expect(readSpanAt(fd, spans[1])).toEqual(page(2))
    } finally {
      fs.closeSync(fd)
    }
  })
})

/**
 * A real fixture: the one copy of PaddleOCR output that never went through a database.
 * Skipped unless it is present on this machine.
 */
const GOLDEN_JSON = path.resolve("dev-data/Oxford Picture Dictionary 3 ed.ocr.json")

describe.skipIf(!fs.existsSync(GOLDEN_JSON))("offsetIndex (golden fixture)", () => {
  it("gives the same object for every page as parsing the whole file does", async () => {
    const whole = JSON.parse(fs.readFileSync(GOLDEN_JSON, "utf8")) as { layoutParsingResults: unknown[] }
    const { spans } = await scanPageSpans(GOLDEN_JSON)

    expect(spans).toHaveLength(whole.layoutParsingResults.length)

    const fd = fs.openSync(GOLDEN_JSON, "r")
    try {
      for (let n = 0; n < spans.length; n++) {
        // Compared page by page rather than sampled: being one byte out is not always
        // visible on minified JSON.
        expect(JSON.stringify(readSpanAt(fd, spans[n]))).toBe(JSON.stringify(whole.layoutParsingResults[n]))
      }
    } finally {
      fs.closeSync(fd)
    }
  })
})
