import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLibrary, type Library } from "../../../src/main/library/library"
import { createLedgerStore } from "../../../src/main/library/ledger"
import { createProgressStore } from "../../../src/main/progress"
import { createBookFolder, createTempRoot } from "../../helpers/bookFolder"

let root: { dir: string; cleanup: () => void } | undefined

afterEach(() => {
  root?.cleanup()
  root = undefined
})

/** A library backed by temp files: a ledger, a progress file, and books anywhere. */
function makeLibrary(libraryRoot?: string): {
  library: Library
  ledgerFile: string
  progressFile: string
  rootDir: string
} {
  root ??= createTempRoot()
  const rootDir = libraryRoot ?? path.join(root.dir, "library")
  fs.mkdirSync(rootDir, { recursive: true })
  const ledgerFile = path.join(root.dir, "library.json")
  const progressFile = path.join(root.dir, "progress.json")

  return {
    library: createLibrary({
      ledger: createLedgerStore({ file: ledgerFile, root: rootDir }),
      progress: createProgressStore({ file: progressFile }),
      now: () => "2026-01-01T00:00:00.000Z",
    }),
    ledgerFile,
    progressFile,
    rootDir,
  }
}

describe("library listing", () => {
  it("is empty before anything is registered", async () => {
    const { library } = makeLibrary()
    expect(await library.list()).toEqual([])
  })

  it("describes a registered book from its meta.json and book.pdf", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, title: "Laws", pageCount: 4 })

    const outcome = await library.open(folder.dir)
    expect(outcome.ok).toBe(true)

    const [doc] = await library.list()
    expect(doc.uid).toBe(folder.uid)
    expect(doc.title).toBe("Laws")
    expect(doc.page_count).toBe(4)
    expect(doc.problem).toBeNull()
    expect(doc.file_size).toBe(fs.statSync(folder.pdfPath).size)
    expect(doc.created_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("keeps a book whose folder was moved away, with the reason", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, title: "Laws" })
    await library.open(folder.dir)

    fs.rmSync(folder.dir, { recursive: true, force: true })

    const [doc] = await library.list()
    expect(doc.uid).toBe(folder.uid)
    expect(doc.problem).toMatch(/the folder is not there/)
    // The entry survives: a folder on an unplugged drive must not look deleted.
    expect(doc.dir).toBe(folder.dir)
  })
})

describe("opening a folder", () => {
  it("registers a book folder that already has a meta.json, writing nothing", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, title: "Existing" })
    const metaBefore = fs.readFileSync(folder.metaPath, "utf8")

    const outcome = await library.open(folder.dir)
    expect(outcome).toMatchObject({ ok: true, adopted: false, alreadyKnown: false })
    expect(fs.readFileSync(folder.metaPath, "utf8")).toBe(metaBefore)
  })

  it("says so when the folder is already in the library", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir })
    await library.open(folder.dir)

    const again = await library.open(folder.dir)
    expect(again).toMatchObject({ ok: true, alreadyKnown: true })
  })

  it("adopts a folder of raw PaddleOCR output by moving it into .lbook/", async () => {
    // What "open a folder somebody handed me" does: `book.pdf` plus a PaddleOCR JSON
    // and maybe a cover, all loose. The metadata is moved into a new `.lbook/` and a
    // `meta.json` is written — pageCount comes from the OCR array itself.
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({
      parent: rootDir,
      omitMeta: true,
      pageCount: 6,
      loose: true,
      cover: { name: "cover.png", data: Buffer.from("png") },
    })

    const outcome = await library.open(folder.dir)
    expect(outcome).toMatchObject({ ok: true, adopted: true })

    // Written by the adoption, so it lands in the metadata folder rather than where
    // the fixture put its loose files.
    const meta = JSON.parse(
      fs.readFileSync(path.join(folder.dir, ".lbook", "meta.json"), "utf8"),
    ) as {
      uid: string
      pageCount: number
      ocrFile: string
      title: string
    }
    expect(meta.pageCount).toBe(6)
    expect(meta.ocrFile).toBe("ocr.json")
    expect(meta.title).toBe(path.basename(folder.dir))
    expect(meta.uid).toMatch(/^[0-9a-f]{32}$/)

    // The loose files moved rather than being copied, and the PDF stayed put.
    expect(fs.existsSync(path.join(folder.dir, ".lbook", "ocr.json"))).toBe(true)
    expect(fs.existsSync(path.join(folder.dir, ".lbook", "cover.png"))).toBe(true)
    expect(fs.existsSync(path.join(folder.dir, "ocr.json"))).toBe(false)
    expect(fs.existsSync(folder.pdfPath)).toBe(true)
  })

  it("keeps the identity of a folder that already carries one", async () => {
    // A folder from before the `.lbook` layout still says who it is: keeping the uid
    // is what keeps the reader's place in the book.
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({
      parent: rootDir,
      uid: "keepthisuid0000keepthisuid0000",
      title: "Kept",
      loose: true,
    })

    const outcome = await library.open(folder.dir)
    expect(outcome.ok).toBe(true)
    expect((await library.list())[0].uid).toBe("keepthisuid0000keepthisuid0000")
    expect((await library.list())[0].title).toBe("Kept")
  })

  it("refuses a folder that is not a book, and says what is missing", async () => {
    const { library, rootDir } = makeLibrary()
    const empty = path.join(rootDir, "just-a-folder")
    fs.mkdirSync(empty, { recursive: true })

    const outcome = await library.open(empty)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected a refusal")
    expect(outcome.error).toMatch(/no book\.pdf and no \.lbook\//)
    expect(fs.existsSync(path.join(empty, "meta.json"))).toBe(false)
    expect(fs.existsSync(path.join(empty, ".lbook"))).toBe(false)
  })

  it("refuses a file, and a folder that does not exist", async () => {
    const { library, rootDir } = makeLibrary()
    const file = path.join(rootDir, "notes.txt")
    fs.writeFileSync(file, "hello")

    expect(await library.open(file)).toMatchObject({ ok: false, error: /not a folder/ })
    expect(await library.open(path.join(rootDir, "nope"))).toMatchObject({
      ok: false,
      error: /does not exist/,
    })
  })

  it("refuses a folder whose ocr.json has no pages", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = path.join(rootDir, "empty-ocr")
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, "book.pdf"), "%PDF-1.7\n")
    fs.writeFileSync(path.join(folder, "ocr.json"), JSON.stringify({ layoutParsingResults: [] }))

    const outcome = await library.open(folder)
    expect(outcome).toMatchObject({ ok: false, error: /no pages/ })
  })
})

describe("reading a book", () => {
  it("maps a page into the renderer's shape", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, pageCount: 3 })
    await library.open(folder.dir)

    const page = await library.getPage(folder.uid, 2)
    expect(page?.page_num).toBe(2)
    expect(page?.uid).toBe(folder.uid)
    expect(page?.markdown_text).toBe("### page 2")
    expect(page?.blocks[0].block_content).toBe("page 2")
  })

  it("answers null for a page the OCR file does not have", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, pageCount: 3 })
    await library.open(folder.dir)

    expect(await library.getPage(folder.uid, 9)).toBeNull()
    expect(await library.getPage(folder.uid, 0)).toBeNull()
  })

  it("reads a byte range inclusively, as the PDF transport sends it", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir })
    await library.open(folder.dir)

    const first = await library.readPdfRange(folder.uid, 0, 7)
    expect(first.toString("utf8")).toBe("%PDF-1.7")
    // One byte means one byte: off-by-one here breaks every rendered page.
    expect((await library.readPdfRange(folder.uid, 0, 0)).length).toBe(1)
    // Past the end returns what exists instead of throwing.
    const tail = await library.readPdfRange(folder.uid, 0, 10_000_000)
    expect(tail.length).toBe(fs.statSync(folder.pdfPath).size)
  })

  it("reads the table of contents when there is one", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({
      parent: rootDir,
      toc: { version: 1, nodes: [{ title: "Chapter 1", page: 1 }] },
    })
    await library.open(folder.dir)

    expect(await library.getToc(folder.uid)).toMatchObject({ nodes: [{ title: "Chapter 1" }] })
  })

  it("reports a malformed toc.json instead of showing an empty tree", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, omitMeta: false })
    await library.open(folder.dir)
    fs.writeFileSync(path.join(folder.dataDir, "toc.json"), "{ oops")

    await expect(library.getToc(folder.uid)).rejects.toThrow(/toc\.json is invalid/)
  })

  it("has no outline when there is no toc.json", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir })
    await library.open(folder.dir)
    expect(await library.getToc(folder.uid)).toBeNull()
  })
})

describe("external edits", () => {
  it("shows an edited meta.json on the next read, without a restart", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, title: "Before" })
    await library.open(folder.dir)
    expect((await library.list())[0].title).toBe("Before")

    // What editing the file in another program looks like: same path, new contents.
    const meta = JSON.parse(fs.readFileSync(folder.metaPath, "utf8")) as Record<
      string,
      unknown
    >
    meta.title = "After"
    fs.writeFileSync(folder.metaPath, `${JSON.stringify(meta, null, 2)}\n`)

    expect((await library.list())[0].title).toBe("After")
  })

  it("re-reads an edited OCR file instead of serving the cached index", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, pageCount: 2 })
    await library.open(folder.dir)
    expect((await library.getPage(folder.uid, 1))?.blocks[0].block_content).toBe("page 1")

    // Rewrite the document with the same page count but different text: the page
    // index is still valid, the bytes are not.
    const document = JSON.parse(fs.readFileSync(folder.ocrPath, "utf8")) as {
      layoutParsingResults: Array<{ prunedResult: { parsing_res_list: Array<{ block_content: string }> } }>
    }
    document.layoutParsingResults[0].prunedResult.parsing_res_list[0].block_content = "edited"
    fs.writeFileSync(folder.ocrPath, JSON.stringify(document))

    expect((await library.getPage(folder.uid, 1))?.blocks[0].block_content).toBe("edited")
  })

  it("re-reads after refresh(), which is what the window calls on focus", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir })
    await library.open(folder.dir)

    const document = JSON.parse(fs.readFileSync(folder.ocrPath, "utf8")) as {
      layoutParsingResults: Array<{ markdown: { text: string } }>
    }
    document.layoutParsingResults[0].markdown.text = "# rewritten"
    fs.writeFileSync(folder.ocrPath, JSON.stringify(document))

    library.refresh()
    expect((await library.getPage(folder.uid, 1))?.markdown_text).toBe("# rewritten")
  })

  it("reports a book that went bad while it was open", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir })
    await library.open(folder.dir)
    expect((await library.list())[0].problem).toBeNull()

    fs.writeFileSync(folder.metaPath, "{ broken")

    const [doc] = await library.list()
    expect(doc.problem).toMatch(/meta\.json/)
    // And the reason is a sentence, not a stack trace.
    expect(doc.problem).not.toMatch(/at [A-Za-z]+ \(/)
  })
})

describe("progress", () => {
  it("keeps a position per book and rejects a page outside the book", async () => {
    const { library, rootDir } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, pageCount: 5 })
    await library.open(folder.dir)

    const saved = await library.progress.save(folder.uid, 3)
    expect(saved.last_page_num).toBe(3)
    expect(library.progress.get(folder.uid)?.last_page_num).toBe(3)

    // The count comes from meta.json, so this costs no scan of the OCR file.
    await expect(library.progress.save(folder.uid, 6)).rejects.toThrow(/outside 1\.\.5/)
    await expect(library.progress.save(folder.uid, 0)).rejects.toThrow(/outside/)
  })
})

describe("removing a book", () => {
  it("forgets the entry and leaves every file on disk (A11)", async () => {
    const { library, rootDir, ledgerFile, progressFile } = makeLibrary()
    const folder = createBookFolder({ parent: rootDir, title: "Keep me" })
    await library.open(folder.dir)
    await library.progress.save(folder.uid, 2)

    expect(library.remove(folder.uid)).toBe(true)

    // The promise the UI makes: the app forgets, the disk is untouched.
    expect(fs.existsSync(folder.metaPath)).toBe(true)
    expect(fs.existsSync(folder.pdfPath)).toBe(true)
    expect(fs.existsSync(folder.ocrPath)).toBe(true)

    expect(JSON.parse(fs.readFileSync(ledgerFile, "utf8"))).toMatchObject({ books: [] })
    // Its reading position goes with it — it is keyed by a book that is gone.
    expect(JSON.parse(fs.readFileSync(progressFile, "utf8"))).toEqual({})
    expect(await library.get(folder.uid)).toBeNull()
  })

  it("answers false for a book that is not in the library", () => {
    const { library } = makeLibrary()
    expect(library.remove("nope")).toBe(false)
  })
})

describe("books outside the default location", () => {
  it("registers a book that lives anywhere on disk", async () => {
    // A11: books may sit on another drive, next to the user's own notes.
    const { library, rootDir } = makeLibrary()
    const outside = createTempRoot()
    try {
      const elsewhere = createBookFolder({ parent: outside.dir, title: "Elsewhere" })

      const outcome = await library.open(elsewhere.dir)
      expect(outcome.ok).toBe(true)

      const [doc] = await library.list()
      expect(doc.uid).toBe(elsewhere.uid)
      expect(doc.dir).toBe(elsewhere.dir)
      expect(doc.problem).toBeNull()
      expect(doc.dir.startsWith(rootDir)).toBe(false)
    } finally {
      outside.cleanup()
    }
  })
})
