import { afterEach, describe, expect, it } from "vitest"
import { createTestContext, insertDocument, type TestContext } from "../../helpers/temp"

let ctx: TestContext

afterEach(() => ctx?.cleanup())

function seedPage(pdfId: number, pageNum: number, blockContents: string[] = []) {
  return ctx.repos.pages.insertPageWithBlocks(
    pdfId,
    {
      page_num: pageNum,
      page_width: 800,
      page_height: 1000,
      model_settings: null,
      markdown_text: `page ${pageNum}`,
      markdown_images: null,
      pruned_result: JSON.stringify({ parsing_res_list: [] }),
      blocks: blockContents.map((content, i) => ({
        block_label: "text",
        block_content: content,
        block_bbox: [0, i * 10, 100, i * 10 + 10],
        block_id: i,
        group_id: 0,
        block_order: i,
      })),
    },
    new Date().toISOString(),
  )
}

describe("document repository", () => {
  it("maps rows to the renderer shape", () => {
    ctx = createTestContext()
    insertDocument(ctx.repos, {
      uid: "abc",
      file_name: "My Book.pdf",
      author: "Someone",
      cover_path: "cover.jpg",
    })

    const [doc] = ctx.repos.documents.listAll()
    expect(doc).toMatchObject({
      uid: "abc",
      title: "My Book.pdf",
      author: "Someone",
      cover_url: "lbook://cover/abc",
      dirty: false,
    })
  })

  it("omits cover_url when there is no cover", () => {
    ctx = createTestContext()
    insertDocument(ctx.repos, { uid: "nocover", cover_path: null })
    expect(ctx.repos.documents.listAll()[0].cover_url).toBeNull()
  })

  it("lists newest first", () => {
    ctx = createTestContext()
    // Explicit values, so the assertion does not depend on the helper's counter.
    insertDocument(ctx.repos, {
      file_name: "old.pdf",
      created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    })
    insertDocument(ctx.repos, {
      file_name: "mid.pdf",
      created_at: new Date(Date.UTC(2026, 0, 2)).toISOString(),
    })
    insertDocument(ctx.repos, {
      file_name: "new.pdf",
      created_at: new Date(Date.UTC(2026, 0, 3)).toISOString(),
    })

    expect(ctx.repos.documents.listAll().map((d) => d.title)).toEqual([
      "new.pdf",
      "mid.pdf",
      "old.pdf",
    ])
  })

  it("tracks the dirty flag", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    ctx.repos.documents.setDirty(id, true)
    expect(ctx.repos.documents.listAll()[0].dirty).toBe(true)

    ctx.repos.documents.updateAfterSave(id, {
      file_hash: "new",
      file_size: 5,
      page_count: 2,
      file_mtime: 123,
    })
    expect(ctx.repos.documents.listAll()[0].dirty).toBe(false)
  })
})

describe("cascade delete", () => {
  it("removes pages and blocks with the document", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    seedPage(id, 1, ["a", "b"])
    seedPage(id, 2, ["c"])

    expect(ctx.repos.pages.count()).toBe(2)
    expect(ctx.repos.blocks.count()).toBe(3)

    ctx.repos.documents.remove(id)

    // Only works because PRAGMA foreign_keys = ON.
    expect(ctx.repos.pages.count()).toBe(0)
    expect(ctx.repos.blocks.count()).toBe(0)
  })

  it("removes blocks when a single page is deleted", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    seedPage(id, 1, ["a", "b"])
    ctx.repos.pages.removeByPdf(id)
    expect(ctx.repos.blocks.count()).toBe(0)
  })
})

describe("block repository", () => {
  it("parses block_bbox JSON into a tuple", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    const pageId = seedPage(id, 1, ["hello"])
    expect(ctx.repos.blocks.listByPage(pageId)[0].block_bbox).toEqual([0, 0, 100, 10])
  })

  it("falls back to a zero bbox on malformed JSON", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    const pageId = seedPage(id, 1, ["hello"])
    ctx.repos.db.prepare(`UPDATE ocr_blocks SET block_bbox = 'not json'`).run()
    expect(ctx.repos.blocks.listByPage(pageId)[0].block_bbox).toEqual([0, 0, 0, 0])
  })

  it("updates content and recomputes is_html_content", () => {
    ctx = createTestContext()
    const id = insertDocument(ctx.repos)
    const pageId = seedPage(id, 1, ["plain"])
    const blockId = ctx.repos.blocks.listByPage(pageId)[0].id

    const updated = ctx.repos.blocks.updateContent(blockId, "<table><tr></tr></table>")
    expect(updated?.block_content).toBe("<table><tr></tr></table>")

    const row = ctx.repos.db
      .prepare(`SELECT is_html_content FROM ocr_blocks WHERE id = ?`)
      .get(blockId) as { is_html_content: number }
    expect(row.is_html_content).toBe(1)
  })

  it("returns null for an unknown block id", () => {
    ctx = createTestContext()
    expect(ctx.repos.blocks.updateContent(9999, "x")).toBeNull()
  })
})

describe("reading progress", () => {
  it("upserts and updates in place", () => {
    ctx = createTestContext()
    const pdfId = insertDocument(ctx.repos, { page_count: 10 })
    const user = ctx.repos.users.getOrCreateAdmin(new Date().toISOString())

    const first = ctx.repos.progress.save(user.id, pdfId, 3, new Date().toISOString())
    expect(first?.last_page_num).toBe(3)

    const second = ctx.repos.progress.save(user.id, pdfId, 7, new Date().toISOString())
    expect(second?.last_page_num).toBe(7)
    expect(ctx.repos.db.prepare(`SELECT COUNT(*) AS n FROM reading_progress`).get()).toEqual({ n: 1 })
  })

  it("rejects a page outside 1..page_count", () => {
    ctx = createTestContext()
    const pdfId = insertDocument(ctx.repos, { page_count: 10 })
    const user = ctx.repos.users.getOrCreateAdmin(new Date().toISOString())

    expect(ctx.repos.progress.save(user.id, pdfId, 0, new Date().toISOString())).toBeNull()
    expect(ctx.repos.progress.save(user.id, pdfId, 11, new Date().toISOString())).toBeNull()
    expect(ctx.repos.progress.get(user.id, pdfId)).toBeNull()
  })

  it("throws when the document does not exist", () => {
    ctx = createTestContext()
    const user = ctx.repos.users.getOrCreateAdmin(new Date().toISOString())
    expect(() => ctx.repos.progress.save(user.id, 4242, 1, new Date().toISOString())).toThrow(
      /PDF not found/,
    )
  })
})

describe("user repository", () => {
  it("creates the admin exactly once", () => {
    ctx = createTestContext()
    const now = new Date().toISOString()
    const first = ctx.repos.users.getOrCreateAdmin(now)
    const second = ctx.repos.users.getOrCreateAdmin(now)

    expect(first.id).toBe(second.id)
    expect(first.username).toBe("admin")
  })
})
