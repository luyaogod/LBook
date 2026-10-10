import { describe, expect, it } from "vitest"
import {
  BOOK_FORMAT_VERSION,
  isSafeBookFileName,
  parseBookMeta,
  writeBookMeta,
  type BookMeta,
} from "../../../src/shared/bookFile"

const valid: BookMeta = {
  formatVersion: BOOK_FORMAT_VERSION,
  uid: "b31d024a",
  title: "BPP Financial Accounting",
  pageCount: 665,
  ocrFile: "bpp-financial-accounting.json",
}

describe("parseBookMeta", () => {
  it("accepts a complete file", () => {
    const result = parseBookMeta({ ...valid, author: "BPP", source: "pp-structurev3" })
    expect(result).toEqual({ ok: true, meta: { ...valid, author: "BPP", source: "pp-structurev3" } })
  })

  it("allows a missing title and reports it as empty, not as an error", () => {
    // A hand-made folder should not be unusable just because nobody wrote a
    // title; the caller falls back to the folder name.
    const { title: _title, ...withoutTitle } = valid
    const result = parseBookMeta(withoutTitle)
    expect(result.ok && result.meta.title).toBe("")
  })

  it("ignores unknown keys instead of rejecting the file", () => {
    // The app never writes meta.json back, so a user's own fields must not break it.
    const result = parseBookMeta({ ...valid, myNotes: { starred: true }, tags: ["a"] })
    expect(result.ok).toBe(true)
  })

  it("refuses a file written by a newer build", () => {
    const result = parseBookMeta({ ...valid, formatVersion: BOOK_FORMAT_VERSION + 1 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain("formatVersion")
  })

  it("refuses the fields it cannot work without", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, uid: "" }, "uid"],
      [{ ...valid, uid: 42 }, "uid"],
      [{ ...valid, ocrFile: "" }, "ocrFile"],
      [{ ...valid, ocrFile: 7 }, "ocrFile"],
      [{ ...valid, pageCount: 0 }, "pageCount"],
      [{ ...valid, pageCount: -3 }, "pageCount"],
      [{ ...valid, pageCount: 1.5 }, "pageCount"],
      [{ ...valid, pageCount: "665" }, "pageCount"],
    ]
    for (const [raw, needle] of cases) {
      const result = parseBookMeta(raw)
      expect(result.ok, JSON.stringify(raw)).toBe(false)
      expect(result.ok === false && result.error).toContain(needle)
    }
  })

  it("refuses an ocrFile that would escape the book folder", () => {
    // The whole point of storing a bare name: a meta.json is data, possibly
    // hand-written, and must not be able to point at another directory.
    for (const ocrFile of ["../other/book.json", "sub/ocr.json", "sub\\ocr.json", "D:\\x.json", "/etc/x.json", ".."]) {
      const result = parseBookMeta({ ...valid, ocrFile })
      expect(result.ok, ocrFile).toBe(false)
      expect(result.ok === false && result.error, ocrFile).toContain("ocrFile")
    }
  })

  it("returns an error, never a throw, for arbitrary garbage", () => {
    for (const raw of [null, undefined, 0, "meta.json", [], [valid], true]) {
      const result = parseBookMeta(raw)
      expect(result.ok, JSON.stringify(raw) ?? "undefined").toBe(false)
    }
  })
})

describe("writeBookMeta", () => {
  it("writes a fixed key order with two-space indent and a trailing newline", () => {
    const text = writeBookMeta({ ...valid, author: "BPP", createdAt: "2026-10-11T00:00:00.000Z" })
    expect(text.endsWith("\n")).toBe(true)
    expect(text).toContain('\n  "uid"')
    // Same fields in a different insertion order must produce the same bytes:
    // that is what makes a book folder diff cleanly.
    const shuffled = writeBookMeta({
      createdAt: "2026-10-11T00:00:00.000Z",
      author: "BPP",
      ocrFile: valid.ocrFile,
      pageCount: valid.pageCount,
      title: valid.title,
      uid: valid.uid,
      formatVersion: valid.formatVersion,
    })
    expect(shuffled).toBe(text)
  })

  it("omits optional keys that are not set, and round-trips through parseBookMeta", () => {
    const text = writeBookMeta(valid)
    expect(text).not.toContain("author")
    expect(text).not.toContain("createdAt")
    expect(parseBookMeta(JSON.parse(text))).toEqual({ ok: true, meta: valid })
  })
})

describe("isSafeBookFileName", () => {
  it("accepts plain names and rejects anything path-like", () => {
    expect(isSafeBookFileName("ocr.json")).toBe(true)
    expect(isSafeBookFileName("我的 书.ocr.json")).toBe(true)
    for (const bad of ["", ".", "..", "a/b.json", "a\\b.json", "C:ocr.json", "/abs.json"]) {
      expect(isSafeBookFileName(bad), bad).toBe(false)
    }
  })
})
