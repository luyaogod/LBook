import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { closeAllArchives } from "../../../src/main/lbook/archiveCache"
import { packageFileName } from "../../../src/main/lbook/manifest"
import {
  readCover,
  readManifest,
  readOcrJson,
  readPdfRange,
  readToc,
  readTocText,
} from "../../../src/main/lbook/reader"
import { validateLbook } from "../../../src/main/lbook/validate"
import { createLibraryService } from "../../../src/main/library/service"
import { buildLbook, fakePdf } from "../../helpers/lbook"
import { createLibraryTestContext, type LibraryTestContext } from "../../helpers/temp"

let ctx: LibraryTestContext

afterEach(() => {
  closeAllArchives()
  ctx?.cleanup()
})

function serviceFor(context: LibraryTestContext) {
  return createLibraryService({
    repos: context.repos,
    getLibraryDir: () => context.libraryDir,
  })
}

/** A package with real OCR pages, so edits have something to attach to. */
function ocrWith(contents: string[]): unknown {
  return {
    dataInfo: { type: "pdf", numPages: 1 },
    layoutParsingResults: [
      {
        prunedResult: {
          width: 800,
          height: 1000,
          layout_det_res: { boxes: ["kept verbatim"] },
          parsing_res_list: contents.map((content, index) => ({
            block_label: "text",
            block_content: content,
            block_bbox: [0, index * 10, 100, index * 10 + 10],
            block_id: index,
            group_id: 0,
            block_order: index,
            global_block_id: index,
            block_polygon_points: [[0, 0], [100, 0], [100, 10]],
          })),
        },
        markdown: { text: "page one", images: {} },
      },
    ],
  }
}

describe("library service", () => {
  it("indexes a package and reads it back", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    await buildLbook({ dir: ctx.libraryDir, title: "Indexed", ocr: ocrWith(["hello"]) })

    const scan = await service.scan()
    expect(scan.added).toBe(1)
    expect(scan.removed).toBe(0)

    const [doc] = service.list()
    expect(doc.title).toBe("Indexed")
    expect(doc.page_count).toBe(1)
    expect(doc.dirty).toBe(false)

    const page = service.getPage(doc.id, 1)
    expect(page?.blocks.map((b) => b.block_content)).toEqual(["hello"])
  })

  it("is a no-op on a second scan", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    await buildLbook({ dir: ctx.libraryDir, title: "Stable", ocr: ocrWith(["a"]) })

    expect((await service.scan()).added).toBe(1)
    const second = await service.scan()
    expect(second.added).toBe(0)
    expect(second.updated).toBe(0)
  })

  it("reports an unreadable package instead of failing the scan", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    fs.writeFileSync(path.join(ctx.libraryDir, "broken.lbook"), "not a zip at all")
    await buildLbook({ dir: ctx.libraryDir, title: "Good", ocr: ocrWith(["a"]) })

    const scan = await service.scan()
    expect(scan.added).toBe(1)
    expect(scan.skipped).toHaveLength(1)
    expect(scan.skipped[0].file).toBe("broken.lbook")
  })

  it("refuses to reimport a package that has unsaved edits", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    await buildLbook({ dir: ctx.libraryDir, title: "Edited", ocr: ocrWith(["a"]) })
    await service.scan()

    const [doc] = service.list()
    const block = service.getPage(doc.id, 1)!.blocks[0]
    service.updateBlock(block.id, "changed")

    // Touch the file so the scan believes it changed on disk.
    const file = path.join(ctx.libraryDir, packageFileName("Edited", doc.uid))
    const later = new Date(Date.now() + 60_000)
    fs.utimesSync(file, later, later)

    const scan = await service.scan()
    expect(scan.skipped).toHaveLength(1)
    expect(scan.skipped[0].reason).toMatch(/unsaved edits/)
    // The edit is still there.
    expect(service.getPage(doc.id, 1)!.blocks[0].block_content).toBe("changed")
  })

  it("drops documents whose package disappeared", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const built = await buildLbook({ dir: ctx.libraryDir, title: "Doomed", ocr: ocrWith(["a"]) })
    await service.scan()
    expect(service.list()).toHaveLength(1)

    fs.rmSync(built.filePath)
    const scan = await service.scan()

    expect(scan.removed).toBe(1)
    expect(service.list()).toHaveLength(0)
    expect(ctx.repos.pages.count()).toBe(0)
    expect(ctx.repos.blocks.count()).toBe(0)
  })
})

describe("save (Excel-style write-back)", () => {
  async function seeded() {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const built = await buildLbook({
      dir: ctx.libraryDir,
      title: "Writable",
      pdf: fakePdf(9000),
      ocr: ocrWith(["original", "second"]),
    })
    await service.scan()
    return { service, built, doc: service.list()[0] }
  }

  it("writes an edited block back into the .lbook", async () => {
    const { service, built, doc } = await seeded()
    const block = service.getPage(doc.id, 1)!.blocks[0]

    service.updateBlock(block.id, "edited in the app")
    expect(service.list()[0].dirty).toBe(true)

    await service.save(doc.id)

    // The package on disk now carries the edit.
    const payload = (await readOcrJson(built.filePath)) as {
      layoutParsingResults: { prunedResult: { parsing_res_list: Array<{ block_content: string }> } }[]
    }
    const blocks = payload.layoutParsingResults[0].prunedResult.parsing_res_list
    expect(blocks.map((b) => b.block_content)).toEqual(["edited in the app", "second"])

    expect(service.list()[0].dirty).toBe(false)
  })

  it("copies the PDF verbatim rather than re-reading or re-compressing it", async () => {
    const { service, built, doc } = await seeded()
    const before = await readPdfRange(built.filePath, 0, 8999)

    service.updateBlock(service.getPage(doc.id, 1)!.blocks[0].id, "x")
    await service.save(doc.id)

    // Byte-for-byte identical, and still stored, so ranges keep working.
    expect((await readPdfRange(built.filePath, 0, 8999)).equals(before)).toBe(true)
    expect((await validateLbook(built.filePath)).ok).toBe(true)
  })

  it("preserves block keys the database has no column for", async () => {
    const { service, built, doc } = await seeded()
    service.updateBlock(service.getPage(doc.id, 1)!.blocks[0].id, "x")
    await service.save(doc.id)

    const payload = (await readOcrJson(built.filePath)) as {
      layoutParsingResults: {
        prunedResult: {
          layout_det_res: unknown
          parsing_res_list: Array<Record<string, unknown>>
        }
      }[]
    }
    const pruned = payload.layoutParsingResults[0].prunedResult

    // Rebuilding from ocr_blocks alone would have dropped these.
    expect(pruned.layout_det_res).toEqual({ boxes: ["kept verbatim"] })
    expect(pruned.parsing_res_list[0].global_block_id).toBe(0)
    expect(pruned.parsing_res_list[0].block_polygon_points).toEqual([[0, 0], [100, 0], [100, 10]])
  })

  it("keeps the package readable after being written over itself", async () => {
    const { service, built, doc } = await seeded()
    service.updateBlock(service.getPage(doc.id, 1)!.blocks[0].id, "again")
    await service.save(doc.id)

    const manifest = await readManifest(built.filePath)
    expect(manifest.title).toBe("Writable")
    expect(manifest.hasOcr).toBe(true)
    expect((await validateLbook(built.filePath)).errors).toEqual([])
  })

  it("leaves no temp file behind", async () => {
    const { service, built, doc } = await seeded()
    service.updateBlock(service.getPage(doc.id, 1)!.blocks[0].id, "x")
    await service.save(doc.id)

    expect(fs.existsSync(`${built.filePath}.tmp`)).toBe(false)
  })
})

describe("table of contents", () => {
  const tocJson = JSON.stringify({
    version: 1,
    source: "printed 目录, scan offset +3",
    nodes: [
      {
        title: "第一章 总论",
        page: 4,
        printedPage: 1,
        children: [{ title: "第一节 法律基础", page: 6, printedPage: 3 }],
      },
    ],
  })

  function writeTocFile(context: LibraryTestContext, contents: string): string {
    const file = path.join(context.dir, "book.toc.json")
    fs.writeFileSync(file, contents, "utf8")
    return file
  }

  async function seeded(withCover: boolean) {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const built = await buildLbook({
      dir: ctx.libraryDir,
      title: "Outlined",
      pdf: fakePdf(9000),
      ocr: ocrWith(["original"]),
      cover: withCover ? { name: "cover.jpg", data: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]) } : null,
    })
    await service.scan()
    return { service, built, doc: service.list()[0] }
  }

  it("has no table of contents until one is imported", async () => {
    const { service, doc } = await seeded(false)
    expect(await service.getToc(doc.id)).toBeNull()
  })

  it("writes the chosen file into the package", async () => {
    const { service, built, doc } = await seeded(false)

    const toc = await service.replaceToc(doc.id, writeTocFile(ctx, tocJson))
    expect(toc.nodes[0].printedPage).toBe(1)

    // Persisted, not merely returned.
    const stored = await readToc(built.filePath)
    expect(stored?.nodes[0].children?.[0].page).toBe(6)
    expect(await service.getToc(doc.id)).toEqual(stored)
  })

  it("keeps the OCR payload and the cover when only the contents change", async () => {
    // A repack rebuilds the archive, so an entry that is not re-added is lost.
    const { service, built, doc } = await seeded(true)
    await service.replaceToc(doc.id, writeTocFile(ctx, tocJson))

    expect(await readOcrJson(built.filePath)).not.toBeNull()
    const cover = await readCover(built.filePath, await readManifest(built.filePath))
    expect(cover?.data.length).toBe(6)
  })

  it("leaves the package untouched when the file is not a table of contents", async () => {
    const { service, built, doc } = await seeded(false)
    const before = await readPdfRange(built.filePath, 0, 8999)
    const file = writeTocFile(ctx, JSON.stringify({ nodes: [{ title: "没有页码" }] }))

    await expect(service.replaceToc(doc.id, file)).rejects.toThrow(/needs a "page"/)
    expect(await readToc(built.filePath)).toBeNull()
    expect((await readPdfRange(built.filePath, 0, 8999)).equals(before)).toBe(true)
  })

  it("removes the entry again on clear", async () => {
    const { service, built, doc } = await seeded(false)
    await service.replaceToc(doc.id, writeTocFile(ctx, tocJson))

    await service.clearToc(doc.id)

    expect(await readTocText(built.filePath)).toBeNull()
    // Removing the outline must not take the book's own data with it.
    expect(await readOcrJson(built.filePath)).not.toBeNull()
  })

  it("survives an ordinary save", async () => {
    const { service, built, doc } = await seeded(true)
    await service.replaceToc(doc.id, writeTocFile(ctx, tocJson))

    service.updateBlock(service.getPage(doc.id, 1)!.blocks[0].id, "edited")
    await service.save(doc.id)

    // Regression: saving rebuilt the package with the OCR entry alone and
    // dropped both the table of contents and the cover.
    expect(await readToc(built.filePath)).not.toBeNull()
    expect(await readCover(built.filePath, await readManifest(built.filePath))).not.toBeNull()
  })

  it("embeds an outline chosen while the book is created", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const pdfPath = path.join(ctx.dir, "incoming.pdf")
    const ocrPath = path.join(ctx.dir, "incoming.json")
    fs.writeFileSync(pdfPath, fakePdf(5000))
    fs.writeFileSync(ocrPath, JSON.stringify(ocrWith(["hello"])))

    const doc = await service.createFromFiles({
      pdfPath,
      ocrPath,
      coverPath: null,
      tocPath: writeTocFile(ctx, tocJson),
    })

    const stored = await service.getToc(doc.id)
    expect(stored?.nodes[0].title).toBe("第一章 总论")
    expect(stored?.nodes[0].children?.[0].page).toBe(6)
  })

  it("refuses a bad outline before it creates anything", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const pdfPath = path.join(ctx.dir, "incoming.pdf")
    const ocrPath = path.join(ctx.dir, "incoming.json")
    fs.writeFileSync(pdfPath, fakePdf(5000))
    fs.writeFileSync(ocrPath, JSON.stringify(ocrWith(["hello"])))

    await expect(
      service.createFromFiles({
        pdfPath,
        ocrPath,
        coverPath: null,
        tocPath: writeTocFile(ctx, JSON.stringify({ nodes: [{ title: "没有页码" }] })),
      }),
    ).rejects.toThrow(/Not a valid table of contents/)

    // Nothing was written: the library folder is still empty.
    expect(service.list()).toHaveLength(0)
    expect(fs.readdirSync(ctx.libraryDir)).toHaveLength(0)
  })
})

describe("importFile", () => {  it("copies a package from outside the library and indexes it", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const outside = await buildLbook({ dir: ctx.dir, title: "Incoming", ocr: ocrWith(["a"]) })

    const doc = await service.importFile(outside.filePath)

    expect(doc.title).toBe("Incoming")
    // Moved into the library folder under a canonical name.
    const expected = path.join(ctx.libraryDir, packageFileName("Incoming", doc.uid))
    expect(fs.existsSync(expected)).toBe(true)
    expect(service.list()).toHaveLength(1)
  })

  it("does not copy a package that already lives in the library", async () => {
    ctx = createLibraryTestContext()
    const service = serviceFor(ctx)
    const inside = await buildLbook({ dir: ctx.libraryDir, title: "Local", ocr: ocrWith(["a"]) })

    await service.importFile(inside.filePath)
    expect(fs.existsSync(inside.filePath)).toBe(true)
  })
})
