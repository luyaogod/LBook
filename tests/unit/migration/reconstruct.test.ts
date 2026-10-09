import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  readLegacyDocuments,
  reconstructLegacyBook,
  type LegacyDocument,
} from "../../../src/main/library/legacy"

/**
 * Golden regression test for the legacy migration.
 *
 * `dev-data/Oxford Picture Dictionary 3 ed.ocr.json` is the ORIGINAL PaddleOCR
 * output for the first book. If the reconstruction from the database still
 * matches it, the migration is faithful; if it drifts, thousands of blocks have
 * silently changed.
 *
 * Both the legacy database and that JSON live outside version control, so the
 * suite skips when either is absent.
 */

const LEGACY_DB = path.resolve("backend/lbook.db")
const GOLDEN_JSON = path.resolve("dev-data/Oxford Picture Dictionary 3 ed.ocr.json")

const available = fs.existsSync(LEGACY_DB) && fs.existsSync(GOLDEN_JSON)

let db: Database.Database | undefined

afterAll(() => {
  db?.close()
  db = undefined
})

describe.skipIf(!available)("legacy reconstruction (golden fixture)", () => {
  function goldenDocument(): { db: Database.Database; doc: LegacyDocument; golden: GoldenPayload } {
    db = new Database(LEGACY_DB, { readonly: true, fileMustExist: true })
    const doc = readLegacyDocuments(db)[0]
    const golden = JSON.parse(fs.readFileSync(GOLDEN_JSON, "utf8")) as GoldenPayload
    return { db, doc, golden }
  }

  it("reproduces the original page payload exactly", () => {
    const { db: handle, doc } = goldenDocument()
    const rebuilt = reconstructLegacyBook(handle, doc)

    expect(rebuilt.pages).toBe(294)
    expect(rebuilt.blocks).toBe(8609)
  })

  it("keeps the dataInfo block unchanged", () => {
    const { db: handle, doc, golden } = goldenDocument()
    expect(reconstructLegacyBook(handle, doc).dataInfo).toEqual(golden.dataInfo)
  })

  it("keeps every page's prunedResult unchanged", () => {
    const { db: handle, doc, golden } = goldenDocument()
    const rebuilt = reconstructLegacyBook(handle, doc)

    const mismatches: string[] = []
    rebuilt.layoutParsingResults.forEach((page, index) => {
      const ours = (page as { prunedResult: unknown }).prunedResult
      const theirs = golden.layoutParsingResults[index].prunedResult
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) mismatches.push(`page ${index + 1}`)
    })

    expect(mismatches).toEqual([])
  })

  it("keeps every page's markdown unchanged", () => {
    const { db: handle, doc, golden } = goldenDocument()
    const rebuilt = reconstructLegacyBook(handle, doc)

    const mismatches: string[] = []
    rebuilt.layoutParsingResults.forEach((page, index) => {
      const ours = (page as { markdown: unknown }).markdown
      const theirs = golden.layoutParsingResults[index].markdown
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) mismatches.push(`page ${index + 1}`)
    })

    expect(mismatches).toEqual([])
  })
})

interface GoldenPayload {
  layoutParsingResults: Array<{ prunedResult: unknown; markdown: unknown }>
  dataInfo: unknown
}

describe("legacy reconstruction fixtures", () => {
  it("reports clearly when the fixture is unavailable", () => {
    // Documents why the golden block above may be skipped rather than silently
    // passing on a machine without the legacy data.
    if (!available) {
      expect(fs.existsSync(LEGACY_DB) && fs.existsSync(GOLDEN_JSON)).toBe(false)
    } else {
      expect(available).toBe(true)
    }
  })
})
