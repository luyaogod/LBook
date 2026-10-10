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

/** 写一份临时 JSON；同一个测试文件里的多次调用共用一个临时目录。 */
function tempJson(text: string): string {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-offset-"))
  const file = path.join(dir, `sample-${String(Math.random()).slice(2)}.json`)
  fs.writeFileSync(file, text, "utf8")
  return file
}

/** 造一份 PaddleOCR 形状的 JSON（两空格缩进，和真实输出一样）。 */
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
    // 7 / 13 / 64 字节的分块会落在引号、逗号、甚至转义序列中间。若状态机需要
    // "跨块残留缓冲"才能工作，这几个尺寸必然有一个失败。
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
    // 5 字节的分块一定会把一个中文字符或 emoji 劈成两半。字符串内部我们只找
    // `"` 与 `\`（单字节），所以劈开不影响。
    const content = "中文内容 🀄 emoji 😀 与拉丁 Latin"
    const file = tempJson(ocrJson([page(1, content), page(2, content), page(3, content)]))

    const { spans } = await scanPageSpans(file, { chunkBytes: 5 })
    expect(spans).toHaveLength(3)
    const first = readSpan(file, spans[0]) as { prunedResult: { parsing_res_list: Array<{ block_content: string }> } }
    expect(first.prunedResult.parsing_res_list[0].block_content).toBe(content)
  })

  it("stops reading once the limit is reached", async () => {
    // 文件要明显大于“前缀（64KB）+ 一个块（1MB）”，这条断言才有意义：这就是
    // 现实里那种 8–40MB 的 OCR JSON。
    const pages = Array.from({ length: 1500 }, (_, i) => page(i + 1, `第 ${i + 1} 页 `.repeat(40)))
    const file = tempJson(ocrJson(pages))

    const { spans, fileBytes, scannedBytes } = await scanPageSpans(file, { limit: 30 })
    expect(spans).toHaveLength(30)
    expect(fileBytes).toBeGreaterThan(2 * 1024 * 1024)
    // 粒度是“前缀 + 一个块”，所以对大文件才省得明显；实测 15.6MB/294 页那次
    // 首屏是 6.9ms（见 baseline.md）。
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
    // 在第 3 页中间切断：前两页完整，第 3 页不该被假装读出来。
    const file = tempJson(text.slice(0, Math.floor(text.length * 0.8)))

    const { spans } = await scanPageSpans(file)
    expect(spans).toHaveLength(2)

    // 而且已经拿到的 span 仍然能独立解析（上层因此可以先显示前两页并报错）。
    const fd = fs.openSync(file, "r")
    try {
      expect(readSpanAt(fd, spans[1])).toEqual(page(2))
    } finally {
      fs.closeSync(fd)
    }
  })
})

/**
 * 真实 fixture：唯一一份未经数据库中转的 PaddleOCR 输出。它在本机存在时才跑
 * （与 `tests/unit/migration/reconstruct.test.ts` 同一套约定）。
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
        // 逐页比对（不是抽查）：扫描器错一位，压缩过的 JSON 上不一定看得出来。
        expect(JSON.stringify(readSpanAt(fd, spans[n]))).toBe(JSON.stringify(whole.layoutParsingResults[n]))
      }
    } finally {
      fs.closeSync(fd)
    }
  })
})
