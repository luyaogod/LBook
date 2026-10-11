import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { readField, writeField } from "../../../src/main/library/edit"
import { createLibrary, type Library } from "../../../src/main/library/library"
import { createLedgerStore } from "../../../src/main/library/ledger"
import { createProgressStore } from "../../../src/main/progress"
import { createBookFolder } from "../../helpers/bookFolder"

/**
 * The write path for a content correction.
 *
 * Two properties carry the design and are checked from several angles:
 *
 *   1. **Only the edited bytes change.** The rest of `ocr.json` — every other page,
 *      the indentation, the coordinates — is compared byte for byte before and after.
 *   2. **A refused edit changes nothing.** A stale editor, a missing field, a page
 *      that is not there: the file's hash is the same afterwards.
 */

let root: string | undefined

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function tempRoot(): string {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-edit-"))
  return root
}

async function makeLibrary(): Promise<{ library: Library; rootDir: string }> {
  const base = tempRoot()
  const rootDir = path.join(base, "library")
  fs.mkdirSync(rootDir, { recursive: true })
  const library = createLibrary({
    ledger: createLedgerStore({ file: path.join(base, "library.json"), root: rootDir }),
    progress: createProgressStore({ file: path.join(base, "progress.json") }),
  })
  return { library, rootDir }
}

/** A book with `pages` pages, each with two blocks and some markdown. */
async function makeBook(pages = 3) {
  const { library, rootDir } = await makeLibrary()
  const folder = createBookFolder({ parent: rootDir, pageCount: pages, title: "Editable" })

  // The fixture writes one block per page; these tests want two, so the document is
  // rewritten before the library opens the book (the page count comes from the file).
  fs.writeFileSync(
    folder.ocrPath,
    JSON.stringify({
      layoutParsingResults: Array.from({ length: pages }, (_, index) =>
        JSON.parse(pageWith([`page ${index + 1}`, `page ${index + 1} b`], `### page ${index + 1}`)),
      ),
      dataInfo: { type: "pdf", numPages: pages, pages: [] },
    }),
    "utf8",
  )

  const opened = await library.open(folder.dir)
  if (!opened.ok) throw new Error(opened.error)
  const ocrPath = folder.ocrPath

  return {
    library,
    uid: folder.uid,
    dir: folder.dir,
    ocrPath,
    /** Reads the file as bytes, for the byte-level assertions. */
    read: () => fs.readFileSync(ocrPath),
    hash: () => createHash("sha256").update(fs.readFileSync(ocrPath)).digest("hex"),
  }
}

/** Replaces the whole page element with a document the tests can predict. */
function pageWith(blocks: string[], markdown: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    prunedResult: {
      width: 1224,
      height: 1584,
      parsing_res_list: blocks.map((content, index) => ({
        block_label: "text",
        block_content: content,
        block_bbox: [index, index + 1, index + 2, index + 3],
      })),
    },
    markdown: { text: markdown, images: {} },
    ...extra,
  })
}

describe("correcting a block", () => {
  it("changes those bytes and nothing else", async () => {
    const book = await makeBook()
    const before = book.read()

    const outcome = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 0,
      value: "修正后的文字，比原来长一点",
      baseValue: "page 2",
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value.delta).toBeGreaterThan(0)

    const after = book.read()
    // The edited bytes are behind us: find the common prefix and suffix and check that
    // everything outside the change is identical.
    let prefix = 0
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
    let suffix = 0
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix++
    }
    const changedInOriginal = before.length - prefix - suffix
    const changedInNew = after.length - prefix - suffix

    // Everything before the common prefix and after the common suffix is identical by
    // construction, so what is left to check is *where* the change landed: inside one
    // string literal, not across a structural byte.
    expect(before[prefix - 1]).toBe(0x22) // the opening quote of the replaced value
    expect(after[prefix + changedInNew]).toBe(0x22) // ... and of the new one
    expect(after.subarray(prefix, prefix + changedInNew).toString()).toContain("修正后的文字")
    // The old value's own bytes are gone, and the file grew by exactly the difference.
    expect(after.length - before.length).toBe(changedInNew - changedInOriginal)
  })

  it("reads back through the app, with the coordinates untouched", async () => {
    const book = await makeBook()

    await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 1,
      value: "second block, corrected",
      baseValue: "page 2 b",
    })

    const page = await book.library.getPage(book.uid, 2)
    expect(page?.blocks[1].block_content).toBe("second block, corrected")
    // The coordinate the OCR tool produced is still exactly what it was.
    expect(page?.blocks[1].block_bbox).toEqual([1, 2, 3, 4])
    // And the page count did not move.
    expect((await book.library.get(book.uid))?.page_count).toBe(3)
  })

  it("leaves the other reading of the page alone (A18)", async () => {
    const book = await makeBook()
    const markdownBefore = (await book.library.getPage(book.uid, 2))?.markdown_text

    await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 0,
      value: "only the block changes",
      baseValue: "page 2",
    })

    // Correcting a block does not rewrite the Markdown, and it is not supposed to:
    // the two are independent readings of the same file.
    expect((await book.library.getPage(book.uid, 2))?.markdown_text).toBe(markdownBefore)
  })
})

describe("correcting the markdown", () => {
  it("writes the page's markdown text", async () => {
    const book = await makeBook()

    const outcome = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "markdown",
      value: "# 新标题\n\n新的正文。",
      baseValue: "### page 1",
    })
    expect(outcome.ok).toBe(true)
    expect((await book.library.getPage(book.uid, 1))?.markdown_text).toBe("# 新标题\n\n新的正文。")
  })

  it("leaves the blocks alone", async () => {
    const book = await makeBook()
    const blocksBefore = (await book.library.getPage(book.uid, 1))?.blocks

    await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "markdown",
      value: "changed",
      baseValue: "### page 1",
    })

    expect((await book.library.getPage(book.uid, 1))?.blocks).toEqual(blocksBefore)
  })

  it("round-trips the awkward characters", async () => {
    const book = await makeBook()
    const nasty = 'quotes " and \\ backslash, newline\n, tab\t, 中文, emoji 😀, and {"json": "looking"}'

    const outcome = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 2,
      field: "markdown",
      value: nasty,
      baseValue: "### page 3",
    })
    expect(outcome.ok).toBe(true)
    expect((await book.library.getPage(book.uid, 3))?.markdown_text).toBe(nasty)
  })
})

describe("refusing an edit", () => {
  it("refuses when the text is not what the editor loaded", async () => {
    const book = await makeBook()
    const hashBefore = book.hash()

    const outcome = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 0,
      value: "my correction",
      baseValue: "something else entirely",
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toMatch(/changed since the editor was opened/)
    // Nothing was written.
    expect(book.hash()).toBe(hashBefore)
  })

  it("refuses a page or a block that is not there", async () => {
    const book = await makeBook()
    const hashBefore = book.hash()

    const noPage = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 99,
      field: "markdown",
      value: "x",
    })
    expect(noPage.ok).toBe(false)

    const noBlock = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "block_content",
      blockIndex: 42,
      value: "x",
    })
    expect(noBlock.ok).toBe(false)
    if (!noBlock.ok) expect(noBlock.error).toMatch(/no block 42/)

    expect(book.hash()).toBe(hashBefore)
  })

  it("refuses a block edit with no block index, and a book that is gone", async () => {
    const book = await makeBook()

    const noIndex = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "block_content",
      value: "x",
    })
    expect(noIndex.ok).toBe(false)
    if (!noIndex.ok) expect(noIndex.error).toMatch(/needs a blockIndex/)

    const gone = await writeField(book.library, { uid: "nope", pageIndex: 0, field: "markdown", value: "x" })
    expect(gone.ok).toBe(false)
    if (!gone.ok) expect(gone.error).toMatch(/no longer in the library/)
  })

  it("treats an unchanged value as a no-op", async () => {
    const book = await makeBook()
    const hashBefore = book.hash()

    const outcome = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "block_content",
      blockIndex: 0,
      value: "page 1",
      baseValue: "page 1",
    })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.value.delta).toBe(0)
    expect(book.hash()).toBe(hashBefore)
  })
})

describe("conflicts between edits", () => {
  it("notices that an earlier edit moved the bytes", async () => {
    // A longer edit on page 1 shifts everything after it. The next edit on page 3 is
    // still found correctly, because the index is dropped and rebuilt rather than
    // trusted with stale offsets.
    const book = await makeBook()

    const first = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 0,
      field: "markdown",
      value: "a much longer replacement than the original markdown text was",
      baseValue: "### page 1",
    })
    expect(first.ok).toBe(true)

    const second = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 2,
      field: "block_content",
      blockIndex: 0,
      value: "third page, corrected",
      baseValue: "page 3",
    })
    expect(second.ok).toBe(true)

    expect((await book.library.getPage(book.uid, 1))?.markdown_text).toMatch(/much longer/)
    expect((await book.library.getPage(book.uid, 3))?.blocks[0].block_content).toBe("third page, corrected")
    expect((await book.library.get(book.uid))?.page_count).toBe(3)
  })

  it("refuses a second edit based on a stale read of the same field", async () => {
    const book = await makeBook()

    await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 0,
      value: "first correction",
      baseValue: "page 2",
    })

    // Somebody still has the editor open on the original text.
    const stale = await writeField(book.library, {
      uid: book.uid,
      pageIndex: 1,
      field: "block_content",
      blockIndex: 0,
      value: "second correction, from the old text",
      baseValue: "page 2",
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error).toMatch(/changed since the editor was opened/)
    expect((await book.library.getPage(book.uid, 2))?.blocks[0].block_content).toBe("first correction")
  })
})

describe("readField", () => {
  it("hands back what is in the file, for an editor to open on", async () => {
    const book = await makeBook()

    expect(await readField(book.library, book.uid, 1, "block_content", 1)).toMatchObject({
      ok: true,
      value: { value: "page 2 b" },
    })
    expect(await readField(book.library, book.uid, 1, "markdown")).toMatchObject({
      ok: true,
      value: { value: "### page 2" },
    })
    // A field that is not there is null, not an error: the editor shows nothing.
    expect(await readField(book.library, book.uid, 0, "block_content", 42)).toMatchObject({
      ok: true,
      value: { value: null },
    })
  })
})
