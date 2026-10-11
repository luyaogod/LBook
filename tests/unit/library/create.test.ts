import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createBook, previewBook, replaceBookFile } from "../../../src/main/library/create"
import { createLibrary, type Library } from "../../../src/main/library/library"
import { createLedgerStore } from "../../../src/main/library/ledger"
import { createProgressStore } from "../../../src/main/progress"
import { COVER_NAMES, LBOOK_DIR, parseBookMeta } from "../../../src/shared/bookFile"
import { pageElement } from "../../helpers/bookFolder"

/**
 * The write side: making a book from files, and replacing its files.
 *
 * Two properties are worth more than the rest and are tested from several angles:
 * a failure leaves **no folder that looks like a book**, and a replacement never
 * destroys the old file before the new one is in place.
 */

let root: string | undefined

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function tempRoot(): string {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-create-"))
  return root
}

function makeLibrary(): { library: Library; libraryRoot: string } {
  const base = tempRoot()
  const libraryRoot = path.join(base, "library")
  fs.mkdirSync(libraryRoot, { recursive: true })
  const library = createLibrary({
    ledger: createLedgerStore({ file: path.join(base, "library.json"), root: libraryRoot }),
    progress: createProgressStore({ file: path.join(base, "progress.json") }),
  })
  return { library, libraryRoot }
}

/** A PDF-shaped file, an OCR JSON with real pages, and optionally the extras. */
function sources(options: { pages?: number; toc?: unknown | null; cover?: boolean } = {}) {
  const dir = path.join(tempRoot(), `sources-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })

  const pdfPath = path.join(dir, "经济法基础2024.pdf")
  fs.writeFileSync(pdfPath, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(256, 0x41)]))

  const ocrPath = path.join(dir, "经济法基础2024.ocr.json")
  const pages = options.pages ?? 4
  fs.writeFileSync(
    ocrPath,
    JSON.stringify({
      layoutParsingResults: Array.from({ length: pages }, (_, i) => pageElement(i + 1)),
      dataInfo: { type: "pdf", numPages: pages },
    }),
    "utf8",
  )

  let tocPath: string | null = null
  if (options.toc !== null) {
    tocPath = path.join(dir, "toc.json")
    fs.writeFileSync(
      tocPath,
      JSON.stringify(options.toc ?? { version: 1, nodes: [{ title: "Chapter 1", page: 1 }] }),
      "utf8",
    )
  }

  let coverPath: string | null = null
  if (options.cover) {
    coverPath = path.join(dir, "cover.png")
    fs.writeFileSync(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  }

  return { dir, pdfPath, ocrPath, tocPath, coverPath }
}

function metaOf(dir: string) {
  const parsed = parseBookMeta(
    JSON.parse(fs.readFileSync(path.join(dir, LBOOK_DIR, "meta.json"), "utf8")) as unknown,
  )
  if (!parsed.ok) throw new Error(`wrote a meta.json this code cannot read: ${parsed.error}`)
  return parsed.meta
}

function foldersIn(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

describe("previewing a new book", () => {
  it("reports the folder name and the page count without writing anything", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources({ pages: 7 })

    const preview = await previewBook({ ...files, destination: libraryRoot })
    expect(preview).toMatchObject({
      ok: true,
      title: "经济法基础2024",
      folderName: "经济法基础2024",
      pageCount: 7,
    })
    // Nothing was created: the preview is what the reader looks at before deciding.
    expect(foldersIn(libraryRoot)).toEqual([])
  })

  it("uses the title the reader typed, and keeps the folder name safe", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources()

    const preview = await previewBook({ ...files, title: 'Laws: part 1/2?', destination: libraryRoot })
    expect(preview).toMatchObject({ ok: true, title: "Laws: part 1/2?", folderName: "Laws- part 1-2" })
  })

  it("numbers a name that is already taken", async () => {
    const { library, libraryRoot } = makeLibrary()
    const first = sources()
    expect((await createBook({ ...first, destination: libraryRoot }, library)).ok).toBe(true)

    const second = sources()
    const preview = await previewBook({ ...second, destination: libraryRoot })
    expect(preview).toMatchObject({ ok: true, folderName: "经济法基础2024-2" })
  })

  it("refuses a file that is not a PDF", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources()
    fs.writeFileSync(files.pdfPath, "this is not a pdf at all")

    const preview = await previewBook({ ...files, destination: libraryRoot })
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(preview.error).toMatch(/does not start with %PDF-/)
  })

  it("refuses JSON that is not PaddleOCR output, and says why", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources()
    fs.writeFileSync(files.ocrPath, JSON.stringify({ hello: "world" }))

    const preview = await previewBook({ ...files, destination: libraryRoot })
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(preview.error).toMatch(/no layoutParsingResults array/)
  })

  it("refuses an empty page array, and JSON that does not parse", async () => {
    const { libraryRoot } = makeLibrary()

    const empty = sources()
    fs.writeFileSync(empty.ocrPath, JSON.stringify({ layoutParsingResults: [] }))
    const emptyPreview = await previewBook({ ...empty, destination: libraryRoot })
    expect(emptyPreview.ok).toBe(false)
    if (!emptyPreview.ok) expect(emptyPreview.error).toMatch(/array is empty/)

    const broken = sources()
    fs.writeFileSync(broken.ocrPath, "{ not json")
    const brokenPreview = await previewBook({ ...broken, destination: libraryRoot })
    expect(brokenPreview.ok).toBe(false)
  })

  it("refuses a table of contents the reader's toc parser rejects", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources({ toc: { version: 1, nodes: [{}] } })

    const preview = await previewBook({ ...files, destination: libraryRoot })
    expect(preview.ok).toBe(false)
    if (preview.ok) return
    expect(preview.error).toMatch(/table of contents is not valid/)
  })

  it("refuses a missing file and a destination that was never chosen", async () => {
    const { libraryRoot } = makeLibrary()
    const files = sources()

    const missing = await previewBook({ ...files, pdfPath: path.join(files.dir, "nope.pdf"), destination: libraryRoot })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/PDF is not there/)

    const noDestination = await previewBook({ ...files, destination: "" })
    expect(noDestination.ok).toBe(false)
    if (!noDestination.ok) expect(noDestination.error).toMatch(/no destination/)
  })
})

describe("creating a book", () => {
  it("writes the layout the app reads: book.pdf plus .lbook/", async () => {
    const { library, libraryRoot } = makeLibrary()
    const files = sources({ pages: 3, cover: true })

    const outcome = await createBook({ ...files, destination: libraryRoot }, library)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const dir = outcome.value.dir
    expect(path.basename(dir)).toBe("经济法基础2024")
    expect(fs.existsSync(path.join(dir, "book.pdf"))).toBe(true)

    const dataDir = path.join(dir, LBOOK_DIR)
    expect(fs.readdirSync(dataDir).sort()).toEqual(["cover.png", "meta.json", "ocr.json", "toc.json"])

    const meta = metaOf(dir)
    expect(meta.pageCount).toBe(3)
    expect(meta.ocrFile).toBe("ocr.json")
    expect(meta.title).toBe("经济法基础2024")
    expect(meta.uid).toMatch(/^[0-9a-f]{32}$/)

    // The OCR file is the file, byte for byte (A7): not re-serialized, not re-indented.
    expect(fs.readFileSync(path.join(dataDir, "ocr.json")).equals(fs.readFileSync(files.ocrPath))).toBe(true)
    // And it is registered, so it shows up in the library.
    expect((await library.list()).map((doc) => doc.uid)).toEqual([meta.uid])
  })

  it("works without a cover or an outline", async () => {
    const { library, libraryRoot } = makeLibrary()
    const files = sources({ toc: null })

    const outcome = await createBook({ ...files, destination: libraryRoot }, library)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(fs.readdirSync(path.join(outcome.value.dir, LBOOK_DIR)).sort()).toEqual([
      "meta.json",
      "ocr.json",
    ])
    expect(await library.getToc(outcome.value.uid)).toBeNull()
  })

  it("creates the destination folder when it is not there yet", async () => {
    const { library } = makeLibrary()
    const files = sources()
    const destination = path.join(tempRoot(), "somewhere", "new")

    const outcome = await createBook({ ...files, destination }, library)
    expect(outcome.ok).toBe(true)
    expect(fs.existsSync(path.join(destination, "经济法基础2024", "book.pdf"))).toBe(true)
  })

  it("leaves no folder behind when the copy fails", async () => {
    // A source that vanishes between the preview and the copy is the realistic way
    // this fails; the point is that nothing that looks like a book is left.
    const { library, libraryRoot } = makeLibrary()
    const files = sources()
    const outcome = await createBook({ ...files, destination: libraryRoot }, library)
    expect(outcome.ok).toBe(true)

    // Now a second one, whose OCR file is removed after validation by pointing the
    // two calls at different files.
    const doomed = sources()
    const preview = await previewBook({ ...doomed, destination: libraryRoot })
    expect(preview.ok).toBe(true)
    fs.rmSync(doomed.ocrPath, { force: true })

    const failed = await createBook({ ...doomed, destination: libraryRoot }, library)
    expect(failed.ok).toBe(false)
    // Only the first book's folder exists; nothing with the staging name survives.
    expect(foldersIn(libraryRoot)).toEqual(["经济法基础2024"])
  })
})

describe("replacing a book's files", () => {
  async function bookWithFiles() {
    const { library, libraryRoot } = makeLibrary()
    const files = sources({ pages: 3, cover: true })
    const created = await createBook({ ...files, destination: libraryRoot }, library)
    if (!created.ok) throw new Error(created.error)
    return { library, uid: created.value.uid, dir: created.value.dir, files }
  }

  it("replaces the OCR file and follows the page count", async () => {
    const { library, uid, dir } = await bookWithFiles()
    const replacement = sources({ pages: 9 })

    const outcome = await replaceBookFile(library, uid, "ocr", replacement.ocrPath)
    expect(outcome).toMatchObject({ ok: true, value: { pageCount: 9 } })

    expect(metaOf(dir).pageCount).toBe(9)
    // And the reader sees nine pages without a restart.
    expect((await library.get(uid))?.page_count).toBe(9)
    expect(await library.getPage(uid, 9)).not.toBeNull()
  })

  it("refuses an OCR file that is not PaddleOCR output, keeping the old one", async () => {
    const { library, uid, dir } = await bookWithFiles()
    const before = fs.readFileSync(path.join(dir, LBOOK_DIR, "ocr.json"))
    const bad = sources()
    fs.writeFileSync(bad.ocrPath, JSON.stringify({ nope: true }))

    const outcome = await replaceBookFile(library, uid, "ocr", bad.ocrPath)
    expect(outcome.ok).toBe(false)
    expect(fs.readFileSync(path.join(dir, LBOOK_DIR, "ocr.json")).equals(before)).toBe(true)
    expect(metaOf(dir).pageCount).toBe(3)
  })

  it("replaces the cover and removes the one it replaced", async () => {
    const { library, uid, dir } = await bookWithFiles()
    const replacement = path.join(files_dir(), "cover.jpg")
    fs.writeFileSync(replacement, Buffer.from([0xff, 0xd8, 0xff, 1]))

    const outcome = await replaceBookFile(library, uid, "cover", replacement)
    expect(outcome.ok).toBe(true)

    // The old cover.png is gone: it would otherwise win the lookup order in
    // coverPath() and make the replacement look like it did nothing.
    const covers = fs.readdirSync(path.join(dir, LBOOK_DIR)).filter((name) => name.startsWith("cover"))
    expect(covers).toEqual(["cover.jpg"])
    expect((await library.get(uid))?.cover_url).toMatch(/^lbook:\/\/cover\//)
  })

  it("replaces the outline and the PDF", async () => {
    const { library, uid, dir } = await bookWithFiles()

    const tocPath = path.join(files_dir(), "toc.json")
    fs.writeFileSync(tocPath, JSON.stringify({ version: 1, nodes: [{ title: "Replaced", page: 2 }] }))
    expect((await replaceBookFile(library, uid, "toc", tocPath)).ok).toBe(true)
    expect((await library.getToc(uid))?.nodes[0].title).toBe("Replaced")

    const pdfPath = path.join(files_dir(), "other.pdf")
    fs.writeFileSync(pdfPath, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(32, 0x42)]))
    expect((await replaceBookFile(library, uid, "pdf", pdfPath)).ok).toBe(true)
    expect(fs.readFileSync(path.join(dir, "book.pdf")).subarray(0, 8).toString()).toBe("%PDF-1.4")
  })

  it("renames the folder with the title, and the ledger follows", async () => {
    // This expectation flipped on 2026-10-11 (A22), and the reason the old one gave is
    // worth keeping: the folder used to stay behind because renaming it would have broken
    // the ledger entry. That is no longer true — identity is the uid inside the book, and
    // `ledger.add` re-points the entry when a folder moves (A21) — so the two names can
    // agree instead, which is Obsidian's rule and what the reader asked for.
    const { library, uid, dir, files } = await bookWithFiles()
    await library.progress.save(uid, 2)

    const outcome = await replaceBookFile(library, uid, "title", "会计: 实务")
    expect(outcome).toMatchObject({
      ok: true,
      value: { title: "会计: 实务", folderName: "会计- 实务", folderRenamed: true },
    })

    // The folder moved, and took everything with it; the characters Windows forbids in a
    // name were replaced on the way.
    const renamed = path.join(path.dirname(dir), "会计- 实务")
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(renamed)).toBe(true)
    expect(metaOf(renamed).title).toBe("会计: 实务")
    expect(fs.readFileSync(path.join(renamed, LBOOK_DIR, "ocr.json"), "utf8")).toBe(
      fs.readFileSync(files.ocrPath, "utf8"),
    )

    // The library finds the book where it is now, and it is still the *same* book: the uid
    // did not change, so neither did the reading position.
    const [doc] = await library.list()
    expect(doc?.uid).toBe(uid)
    expect(doc?.dir).toBe(renamed)
    expect(doc?.problem).toBeNull()
    expect(library.progress.get(uid)?.last_page_num).toBe(2)
    expect((await library.getPage(uid, 3))?.blocks.length).toBeGreaterThan(0)
  })

  it("leaves the folder alone when the new title slugs to the same name", async () => {
    const { library, uid, dir } = await bookWithFiles()

    // A title that only differs where the folder name cannot: the slug is the same, so
    // there is nothing to rename — and no `-2` folder appears for what is the same book.
    const outcome = await replaceBookFile(library, uid, "title", `  ${path.basename(dir)}  `)
    expect(outcome).toMatchObject({ ok: true, value: { folderRenamed: false } })
    expect(fs.existsSync(dir)).toBe(true)
    expect(fs.readdirSync(path.dirname(dir)).filter((name) => name.endsWith("-2"))).toEqual([])
  })

  it("adds -2 when the new name is taken by another book", async () => {
    const { library, uid, dir } = await bookWithFiles()
    const sources2 = sources({ pages: 2 })
    const second = await createBook(
      { ...sources2, title: "已经占用的名字", destination: path.dirname(dir) },
      library,
    )
    if (!second.ok) throw new Error(second.error)

    const outcome = await replaceBookFile(library, uid, "title", "已经占用的名字")
    expect(outcome).toMatchObject({ ok: true, value: { folderName: "已经占用的名字-2" } })
    expect(fs.existsSync(path.join(path.dirname(dir), "已经占用的名字-2"))).toBe(true)
    // Both books are still listed, each once.
    expect((await library.list()).map((doc) => doc.uid).sort()).toEqual([uid, second.value.uid].sort())
  })

  it.skipIf(process.platform !== "win32")(
    "keeps the title and reports the folder when a file inside it is open",
    async () => {
      // Measured, not assumed: on Windows a file held open *inside* a folder makes
      // renaming that folder fail with EPERM (the app's own `fs.watch` does not). This is
      // the realistic case — an editor or a scanner sitting on `ocr.json` — so the title is
      // saved anyway and the reader is told what happened, and was told it can be retried.
      const { library, uid, dir } = await bookWithFiles()
      const handle = fs.openSync(path.join(dir, "book.pdf"), "r")

      try {
        const outcome = await replaceBookFile(library, uid, "title", "改不了文件夹的名字")
        expect(outcome.ok).toBe(true)
        if (!outcome.ok) return
        expect(outcome.value.folderProblem).toMatchObject({ code: "message.renameFolder.failed" })
        expect(outcome.value.folderRenamed).toBe(false)

        // The name is saved, the folder is where it was, and the book still opens.
        expect(metaOf(dir).title).toBe("改不了文件夹的名字")
        expect(fs.existsSync(dir)).toBe(true)
        expect((await library.get(uid))?.title).toBe("改不了文件夹的名字")
      } finally {
        fs.closeSync(handle)
      }

      // Once whatever held it lets go, saving again moves the folder.
      expect((await replaceBookFile(library, uid, "title", "现在可以了")).ok).toBe(true)
      expect(fs.existsSync(path.join(path.dirname(dir), "现在可以了"))).toBe(true)
    },
  )


  it("refuses an empty title, a non-PDF and a non-image cover", async () => {
    const { library, uid } = await bookWithFiles()

    expect((await replaceBookFile(library, uid, "title", "   ")).ok).toBe(false)
    const notPdf = path.join(files_dir(), "notes.txt")
    fs.writeFileSync(notPdf, "hello")
    const pdfOutcome = await replaceBookFile(library, uid, "pdf", notPdf)
    expect(pdfOutcome.ok).toBe(false)
    if (!pdfOutcome.ok) expect(pdfOutcome.error).toMatch(/not a PDF/)
    const coverOutcome = await replaceBookFile(library, uid, "cover", notPdf)
    expect(coverOutcome.ok).toBe(false)
  })

  it("reports a book that is not in the library", async () => {
    const { library } = makeLibrary()
    const outcome = await replaceBookFile(library, "nope", "title", "x")
    expect(outcome).toMatchObject({ ok: false, error: /no longer in the library/ })
  })

  it("knows every cover name it removes", () => {
    // A guard on the constant itself: the replacement path deletes the others, so a
    // name missing here would leave a stale cover behind.
    expect(COVER_NAMES).toContain("cover.png")
    expect(COVER_NAMES).toContain("cover.jpg")
  })
})

/** A scratch directory for files that are not sources of a whole book. */
function files_dir(): string {
  const dir = path.join(tempRoot(), `scratch-${Math.random().toString(36).slice(2, 8)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
