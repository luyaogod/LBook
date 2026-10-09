import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { closeAllArchives, getArchive, openArchiveCount } from "../../../src/main/lbook/archiveCache"
import { ENTRY_PDF } from "../../../src/main/lbook/manifest"
import {
  readCover,
  readManifest,
  readOcrJson,
  readOcrText,
  readPdfRange,
  readToc,
  readTocText,
  pdfSize,
} from "../../../src/main/lbook/reader"
import { buildLbook, fakePdf } from "../../helpers/lbook"

let dir: string | undefined

afterEach(() => {
  closeAllArchives()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-reader-"))
  return dir
}

describe("readPdfRange", () => {
  it("returns the PDF magic at offset 0", async () => {
    // The single assertion that proves every offset in the package is right.
    // If this passes, the local-file-header arithmetic is correct.
    const { filePath } = await buildLbook({ dir: tempDir() })
    const head = await readPdfRange(filePath, 0, 8)
    expect(head.subarray(0, 5).toString("latin1")).toBe("%PDF-")
  })

  it("matches a slice of the original bytes at every offset", async () => {
    const pdf = fakePdf(20_000)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    for (const [begin, end] of [
      [0, 63],
      [1234, 9999],
      [19_000, 19_999],
    ]) {
      const chunk = await readPdfRange(filePath, begin, end)
      expect(chunk.equals(pdf.subarray(begin, end + 1))).toBe(true)
    }
  })

  it("clamps a chunk that runs past the end of the book", async () => {
    const pdf = fakePdf(70_000)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    // pdf.js's default rangeChunkSize is 64 KiB, so the final chunk of a book
    // is short — it must be clamped to the real end, not zero-padded.
    const total = await pdfSize(filePath)
    expect(total).toBe(pdf.length)

    const chunk = await readPdfRange(filePath, 65_536, 131_071)
    expect(chunk.length).toBe(total - 65_536)
    expect(chunk.equals(pdf.subarray(65_536))).toBe(true)
  })

  it("rejects a package whose PDF is deflated", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), compressPdf: true })
    await expect(readPdfRange(filePath, 0, 8)).rejects.toThrow(/require a stored entry/)
  })
})

describe("book metadata", () => {
  it("reads the manifest", async () => {
    const { filePath, uid } = await buildLbook({ dir: tempDir(), title: "My Book" })
    const manifest = await readManifest(filePath)
    expect(manifest.uid).toBe(uid)
    expect(manifest.title).toBe("My Book")
    expect(manifest.format).toBe("lbook")
  })

  it("reports the stored PDF size, which is what the range transport needs", async () => {
    const pdf = fakePdf(3333)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })
    expect(await pdfSize(filePath)).toBe(pdf.length)
  })

  it("returns the OCR payload when present and null when absent", async () => {
    const withOcr = await buildLbook({ dir: tempDir(), ocr: { dataInfo: { type: "pdf" } } })
    expect(await readOcrJson(withOcr.filePath)).toEqual({ dataInfo: { type: "pdf" } })

    const withoutOcr = await buildLbook({ dir: tempDir(), ocr: null })
    expect(await readOcrJson(withoutOcr.filePath)).toBeNull()
  })

  it("reads the cover bytes and MIME type", async () => {
    const coverBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const { filePath } = await buildLbook({
      dir: tempDir(),
      cover: { name: "cover.jpg", data: coverBytes },
    })

    const cover = await readCover(filePath, await readManifest(filePath))
    expect(cover?.mime).toBe("image/jpeg")
    expect(cover?.data.equals(coverBytes)).toBe(true)
  })

  it("returns null when the manifest declares no cover", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), cover: null })
    expect(await readCover(filePath, await readManifest(filePath))).toBeNull()
  })
})

describe("table of contents", () => {
  const toc = {
    version: 1,
    source: "printed 目录",
    nodes: [{ title: "第一章 总论", page: 4, printedPage: 1 }],
  }

  it("reads toc.json back as a tree", async () => {
    const { filePath } = await buildLbook({
      dir: tempDir(),
      extra: [{ name: "toc.json", data: Buffer.from(JSON.stringify(toc)) }],
    })

    const parsed = await readToc(filePath)
    expect(parsed?.nodes[0].title).toBe("第一章 总论")
    expect(parsed?.nodes[0].printedPage).toBe(1)
  })

  it("returns null for a book that has no toc.json", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })
    expect(await readToc(filePath)).toBeNull()
    expect(await readTocText(filePath)).toBeNull()
  })

  it("reports a malformed toc.json instead of pretending the book has none", async () => {
    // Silently showing an empty tree would hide the typo in a file the user
    // just hand-edited.
    const { filePath } = await buildLbook({
      dir: tempDir(),
      extra: [{ name: "toc.json", data: Buffer.from("{ not json") }],
    })
    await expect(readToc(filePath)).rejects.toThrow(/toc\.json is invalid/)
  })

  it("hands back the raw OCR text, edits included", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), ocr: { layoutParsingResults: [] } })
    expect(await readOcrText(filePath)).toBe(JSON.stringify({ layoutParsingResults: [] }))
  })
})

describe("archive cache", () => {
  it("reuses one handle across repeated reads", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })

    const first = await getArchive(filePath)
    await readPdfRange(filePath, 0, 8)
    const second = await getArchive(filePath)

    expect(second).toBe(first)
    expect(openArchiveCount()).toBe(1)
  })

  it("evicts everything on closeAllArchives", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })
    await readPdfRange(filePath, 0, 8)
    expect(openArchiveCount()).toBe(1)

    closeAllArchives()
    expect(openArchiveCount()).toBe(0)

    // Still readable afterwards — the handle is simply reopened.
    expect((await readPdfRange(filePath, 0, 3)).toString("latin1")).toBe("%PDF")
  })

  it("resolves relative and absolute paths to the same cache entry", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })
    const absolute = path.resolve(filePath)

    await getArchive(absolute)
    await getArchive(absolute)
    expect(openArchiveCount()).toBe(1)
    expect(ENTRY_PDF).toBe("book.pdf")
  })

  it("shares a single handle between concurrent callers", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })

    // importPackage does exactly this via Promise.all. If each call opened its
    // own archive, the second one would replace the first in the cache and the
    // first handle would leak with nothing left able to close it.
    const [first, second] = await Promise.all([getArchive(filePath), getArchive(filePath)])
    expect(second).toBe(first)
    expect(openArchiveCount()).toBe(1)

    // The symptom of a leaked handle is that the package can never be replaced,
    // which would break saving a book forever.
    await closeAllArchives()
    const dummy = path.join(dir!, "dummy.bin")
    fs.writeFileSync(dummy, "replacement")
    await expect(fs.promises.rename(dummy, filePath)).resolves.toBeUndefined()
  })
})
