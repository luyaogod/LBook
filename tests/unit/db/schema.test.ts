import { afterEach, describe, expect, it } from "vitest"
import { CURRENT_SCHEMA_VERSION } from "../../../src/main/db/migrate"
import { createTestContext, insertDocument, type TestContext } from "../../helpers/temp"

let ctx: TestContext

afterEach(() => ctx?.cleanup())

describe("schema", () => {
  it("creates every table", () => {
    ctx = createTestContext()
    const names = (
      ctx.repos.db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as { name: string }[]
    ).map((row) => row.name)

    expect(names).toEqual(
      expect.arrayContaining([
        "pdf_documents",
        "ocr_pages",
        "ocr_blocks",
        "users",
        "reading_progress",
      ]),
    )
  })

  it("records the schema version", () => {
    ctx = createTestContext()
    expect(ctx.repos.db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("has foreign_keys enabled", () => {
    // SQLite defaults this OFF; without it ON DELETE CASCADE is inert and
    // deleting a book would orphan tens of thousands of blocks.
    ctx = createTestContext()
    expect(ctx.repos.db.pragma("foreign_keys", { simple: true })).toBe(1)
  })

  it("enforces UNIQUE(pdf_id, page_num)", () => {
    ctx = createTestContext()
    const pdfId = insertDocument(ctx.repos)
    const now = new Date().toISOString()
    const page = { page_num: 1, page_width: 100, page_height: 100 }

    ctx.repos.pages.insertPageWithBlocks(
      pdfId,
      { ...page, model_settings: null, markdown_text: null, markdown_images: null, pruned_result: "{}", blocks: [] },
      now,
    )

    expect(() =>
      ctx.repos.pages.insertPageWithBlocks(
        pdfId,
        { ...page, model_settings: null, markdown_text: null, markdown_images: null, pruned_result: "{}", blocks: [] },
        now,
      ),
    ).toThrow(/UNIQUE/i)
  })

  it("enforces UNIQUE on uid and file_hash", () => {
    ctx = createTestContext()
    insertDocument(ctx.repos, { uid: "dup", file_hash: "h1" })
    expect(() => insertDocument(ctx.repos, { uid: "dup", file_hash: "h2" })).toThrow(/UNIQUE/i)
    expect(() => insertDocument(ctx.repos, { uid: "other", file_hash: "h1" })).toThrow(/UNIQUE/i)
  })
})
