import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { COMPRESSION_DEFLATE, COMPRESSION_STORE, ZipArchive, isSafeEntryName } from "../../../src/main/lbook/zipIndex"
import { ENTRY_MANIFEST, ENTRY_PDF } from "../../../src/main/lbook/manifest"
import { buildLbook, fakePdf, writeRawZip } from "../../helpers/lbook"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-zip-"))
  return dir
}

describe("isSafeEntryName", () => {
  it("accepts ordinary relative names", () => {
    expect(isSafeEntryName("book.pdf")).toBe(true)
    expect(isSafeEntryName("assets/imgs/a.jpg")).toBe(true)
  })

  it("rejects traversal and absolute names", () => {
    expect(isSafeEntryName("../evil")).toBe(false)
    expect(isSafeEntryName("a/../../evil")).toBe(false)
    expect(isSafeEntryName("/abs/path")).toBe(false)
    expect(isSafeEntryName("C:evil")).toBe(false)
    expect(isSafeEntryName("a\\b")).toBe(false)
    expect(isSafeEntryName("")).toBe(false)
  })
})

describe("ZipArchive", () => {
  it("indexes entries with sizes and methods", async () => {
    const pdf = fakePdf(2048)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    const archive = await ZipArchive.open(filePath)
    try {
      const pdfEntry = archive.getEntry(ENTRY_PDF)
      expect(pdfEntry).not.toBeNull()
      expect(pdfEntry?.compressionMethod).toBe(COMPRESSION_STORE)
      expect(pdfEntry?.uncompressedSize).toBe(pdf.length)
      expect(pdfEntry?.compressedSize).toBe(pdf.length)

      // manifest.json is deflate-compressed by default in the fixture.
      expect(archive.getEntry(ENTRY_MANIFEST)?.compressionMethod).toBe(COMPRESSION_DEFLATE)
      expect(archive.has("nope.txt")).toBe(false)
      expect(archive.getEntry("nope.txt")).toBeNull()
    } finally {
      archive.close()
    }
  })

  it("resolves the data offset from the local file header", async () => {
    const pdf = fakePdf(64)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    const archive = await ZipArchive.open(filePath)
    try {
      const dataStart = await archive.dataStartOf(ENTRY_PDF)
      // book.pdf is written first, so its local header sits at offset 0:
      // 30-byte fixed header + 8-byte name + 0-byte extra field.
      expect(dataStart).toBe(38)

      const head = Buffer.alloc(5)
      const handle = await fs.promises.open(filePath, "r")
      await handle.read(head, 0, 5, dataStart)
      await handle.close()
      expect(head.toString("latin1")).toBe("%PDF-")
    } finally {
      archive.close()
    }
  })

  it("caches the resolved data offset", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })
    const archive = await ZipArchive.open(filePath)
    try {
      expect(await archive.dataStartOf(ENTRY_PDF)).toBe(await archive.dataStartOf(ENTRY_PDF))
    } finally {
      archive.close()
    }
  })

  it("reads arbitrary byte ranges of a stored entry", async () => {
    const pdf = fakePdf(5000)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    const archive = await ZipArchive.open(filePath)
    try {
      expect((await archive.readRange(ENTRY_PDF, 0, 7)).toString("latin1")).toBe("%PDF-1.7")

      const chunk = await archive.readRange(ENTRY_PDF, 1000, 1099)
      expect(chunk.length).toBe(100)
      expect(chunk.equals(pdf.subarray(1000, 1100))).toBe(true)

      // The last byte of the true end of file.
      const tail = await archive.readRange(ENTRY_PDF, pdf.length - 6, pdf.length - 1)
      expect(tail.toString("latin1")).toBe("%%EOF\n")
    } finally {
      archive.close()
    }
  })

  it("clamps ranges that run past the end of the entry", async () => {
    const pdf = fakePdf(100)
    const { filePath } = await buildLbook({ dir: tempDir(), pdf })

    const archive = await ZipArchive.open(filePath)
    try {
      const clamped = await archive.readRange(ENTRY_PDF, pdf.length - 10, pdf.length + 500)
      expect(clamped.length).toBe(10)
      expect((await archive.readRange(ENTRY_PDF, pdf.length, pdf.length + 10)).length).toBe(0)
    } finally {
      archive.close()
    }
  })

  it("refuses byte-range reads on a compressed entry", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), compressPdf: true })
    const archive = await ZipArchive.open(filePath)
    try {
      await expect(archive.readRange(ENTRY_PDF, 0, 8)).rejects.toThrow(/require a stored entry/)
    } finally {
      archive.close()
    }
  })

  it("reads a whole compressed entry", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), ocr: { hello: "world" } })
    const archive = await ZipArchive.open(filePath)
    try {
      expect(await archive.readJson<{ hello: string }>("ocr.json")).toEqual({ hello: "world" })
    } finally {
      archive.close()
    }
  })

  it("normalizes backslashes rather than treating them as separators", async () => {
    // yauzl rewrites 0x5C to 0x2F on read, so a Windows-style name can never
    // reach the filesystem as a separator. Asserted rather than assumed.
    const BACKSLASH = String.fromCharCode(92)
    const { filePath } = await buildLbook({
      dir: tempDir(),
      extra: [{ name: `a${BACKSLASH}b.txt`, data: Buffer.from("x") }],
    })

    const archive = await ZipArchive.open(filePath)
    try {
      expect(archive.has("a/b.txt")).toBe(true)
    } finally {
      archive.close()
    }
  })

  it("refuses to open a hostile package containing a traversal entry", async () => {
    // yazl will not write this name, so it is hand-built — which is the only
    // way to represent a .lbook produced by some other, hostile tool.
    // yauzl validates names while parsing, so the archive fails closed before
    // any of its entries are indexed. isSafeEntryName stays as defence in depth.
    const filePath = writeRawZip(path.join(tempDir(), "hostile.lbook"), [
      { name: "../escape.txt", data: Buffer.from("pwned") },
      { name: "ok.txt", data: Buffer.from("fine") },
    ])

    await expect(ZipArchive.open(filePath)).rejects.toThrow(/invalid relative path/)
  })

  it("throws when opening something that is not a zip", async () => {
    const bad = path.join(tempDir(), "not-a-book.lbook")
    fs.writeFileSync(bad, "definitely not a zip file, just plain text here")
    await expect(ZipArchive.open(bad)).rejects.toThrow()
  })
})
