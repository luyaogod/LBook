import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { openBook, coverPath, readTocText } from "../../../src/main/library/book"
import { BOOK_FORMAT_VERSION, LBOOK_DIR, writeBookMeta, type BookMeta } from "../../../src/shared/bookFile"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function page(n: number): unknown {
  return {
    prunedResult: {
      width: 1224,
      height: 1584,
      parsing_res_list: [{ block_label: "text", block_content: `第 ${n} 页`, block_bbox: [1, 2, 3, 4] }],
    },
    markdown: { text: `### 页 ${n}`, images: {} },
  }
}

interface BookFolder {
  dir: string
  /** The `.lbook` directory inside it. */
  dataDir: string
  pages: unknown[]
}

/** Builds a book folder the way the app writes one: book.pdf plus a .lbook directory. */
function bookFolder(options: { pages?: unknown[]; meta?: Partial<BookMeta>; omit?: Array<"ocr" | "pdf" | "meta"> } = {}): BookFolder {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-book-"))
  const folder = path.join(dir, `book-${String(Math.random()).slice(2)}`)
  const dataDir = path.join(folder, LBOOK_DIR)
  fs.mkdirSync(dataDir, { recursive: true })

  const pages = options.pages ?? [page(1), page(2), page(3)]
  const ocrFile = "ocr.json"
  const meta: BookMeta = {
    formatVersion: BOOK_FORMAT_VERSION,
    uid: "uid-test",
    title: "Test Book",
    pageCount: pages.length,
    ocrFile,
    ...options.meta,
  }

  const omit = options.omit ?? []
  if (!omit.includes("meta")) {
    fs.writeFileSync(path.join(dataDir, "meta.json"), writeBookMeta(meta), "utf8")
  }
  if (!omit.includes("ocr")) {
    fs.writeFileSync(
      path.join(dataDir, ocrFile),
      JSON.stringify({ layoutParsingResults: pages }, null, 2),
      "utf8",
    )
  }
  if (!omit.includes("pdf")) fs.writeFileSync(path.join(folder, "book.pdf"), "%PDF-1.4\n%fake\n", "utf8")

  return { dir: folder, dataDir, pages }
}

describe("openBook", () => {
  it("reads pages by 1-based number, lazily indexing", async () => {
    const book = bookFolder()
    const open = await openBook(book.dir)

    expect(open.meta.title).toBe("Test Book")
    expect(open.hasPdf).toBe(true)
    expect(await open.pageCount()).toBe(3)
    // 1-based pages, 0-based array (A8).
    expect(await open.readPage(1)).toEqual(book.pages[0])
    expect(await open.readPage(3)).toEqual(book.pages[2])
  })

  it("keeps working when the chunk size forces many boundaries", async () => {
    // The same guarantee offsetIndex makes, but through the book handle: pages
    // must not change because of where reads happen to land.
    const book = bookFolder({ pages: [page(1), page(2), page(3), page(4)] })
    const open = await openBook(book.dir, { chunkBytes: 9 })
    for (let n = 1; n <= 4; n++) {
      expect(await open.readPage(n), `page ${n}`).toEqual(book.pages[n - 1])
    }
  })

  it("refuses page numbers that are not in the book", async () => {
    const open = await openBook(bookFolder().dir)
    await expect(open.readPage(4)).rejects.toThrow(/not in this book \(3 pages\)/)
    await expect(open.readPage(0)).rejects.toThrow(/start at 1/)
    await expect(open.readPage(1.5)).rejects.toThrow(/start at 1/)
  })

  it("reports the page count the OCR file actually has, not what meta claims", async () => {
    // A mismatch is the library validator's business (Phase 2); here the real
    // number is what wins, so the reader can never ask for a page that is not there.
    const open = await openBook(bookFolder({ meta: { pageCount: 99 } }).dir)
    expect(await open.pageCount()).toBe(3)
  })

  it("opens a book whose PDF is missing, and says so", async () => {
    const open = await openBook(bookFolder({ omit: ["pdf"] }).dir)
    expect(open.hasPdf).toBe(false)
    expect(await open.readPage(1)).toEqual(page(1))
  })

  it("refuses a folder whose meta.json is missing, unreadable or incomplete", async () => {
    await expect(openBook(bookFolder({ omit: ["meta"] }).dir)).rejects.toThrow(/cannot read/)

    const broken = bookFolder()
    fs.writeFileSync(path.join(broken.dataDir, "meta.json"), "{ not json", "utf8")
    await expect(openBook(broken.dir)).rejects.toThrow(/cannot read/)

    const noUid = bookFolder()
    fs.writeFileSync(
      path.join(noUid.dataDir, "meta.json"),
      JSON.stringify({ formatVersion: 1, pageCount: 3, ocrFile: "ocr.json" }),
      "utf8",
    )
    await expect(openBook(noUid.dir)).rejects.toThrow(/no uid/)
  })

  it("refuses a meta.json whose ocrFile is missing or points outside the folder", async () => {
    await expect(openBook(bookFolder({ omit: ["ocr"] }).dir)).rejects.toThrow(/not in .*\.lbook/)

    // Path traversal: meta.json is user-writable data and must not be able to
    // send the reader outside the book folder.
    const escaping = bookFolder({ meta: { ocrFile: "../outside.json" } })
    await expect(openBook(escaping.dir)).rejects.toThrow(/ocrFile/)

    const outside = bookFolder()
    fs.writeFileSync(
      path.join(outside.dataDir, "meta.json"),
      JSON.stringify({ formatVersion: 1, uid: "u", pageCount: 3, ocrFile: "../../secret.json" }),
      "utf8",
    )
    await expect(openBook(outside.dir)).rejects.toThrow(/ocrFile/)
  })
})

describe("book folder extras", () => {
  it("finds a cover by any of the usual names, and nothing when there is none", () => {
    const book = bookFolder()
    expect(coverPath(book.dir)).toBeNull()
    // The cover belongs to the book, so it lives in the metadata folder rather than
    // on top of the PDF.
    const cover = path.join(book.dataDir, "cover.png")
    fs.writeFileSync(cover, "png", "utf8")
    expect(coverPath(book.dir)).toBe(cover)
  })

  it("returns raw toc.json text, or null when the book has no outline", () => {
    const book = bookFolder()
    expect(readTocText(book.dir)).toBeNull()
    fs.writeFileSync(path.join(book.dataDir, "toc.json"), '[{"title":"Ch 1","page":1}]', "utf8")
    expect(readTocText(book.dir)).toContain("Ch 1")
  })
})
