import { describe, expect, it } from "vitest"
import {
  LBOOK_FORMAT,
  LBOOK_FORMAT_VERSION,
  parseManifest,
  packageFileName,
  slugify,
} from "../../../src/main/lbook/manifest"

describe("parseManifest", () => {
  const valid = {
    format: LBOOK_FORMAT,
    formatVersion: LBOOK_FORMAT_VERSION,
    uid: "abc123",
    title: "A Book",
    author: "An Author",
    createdAt: "2026-01-01T00:00:00.000Z",
    pageCount: 12,
    pdfSize: 1000,
    pdfSha256: "f".repeat(64),
    hasOcr: true,
    cover: { name: "cover.jpg", mime: "image/jpeg" },
    generator: "LBook 1.0.0",
  }

  it("round-trips a complete manifest", () => {
    expect(parseManifest(JSON.stringify(valid))).toEqual(valid)
  })

  it("fills in defaults for missing optional fields", () => {
    const parsed = parseManifest(
      JSON.stringify({ format: LBOOK_FORMAT, formatVersion: 1, uid: "u1" }),
    )

    expect(parsed.title).toBe("Untitled")
    expect(parsed.author).toBeNull()
    expect(parsed.cover).toBeNull()
    expect(parsed.hasOcr).toBe(false)
    expect(parsed.pageCount).toBe(0)
  })

  it("normalizes a blank author to null", () => {
    const parsed = parseManifest(
      JSON.stringify({ format: LBOOK_FORMAT, formatVersion: 1, uid: "u", author: "" }),
    )
    expect(parsed.author).toBeNull()
  })

  it("drops a malformed cover reference", () => {
    const parsed = parseManifest(
      JSON.stringify({ format: LBOOK_FORMAT, formatVersion: 1, uid: "u", cover: { name: "" } }),
    )
    expect(parsed.cover).toBeNull()
  })

  it("rejects a manifest with the wrong format marker", () => {
    expect(() =>
      parseManifest(JSON.stringify({ format: "epub", uid: "u", formatVersion: 1 })),
    ).toThrow(/not an LBook manifest/)
  })

  it("rejects a manifest with no uid", () => {
    expect(() =>
      parseManifest(JSON.stringify({ format: LBOOK_FORMAT, formatVersion: 1 })),
    ).toThrow(/not an LBook manifest/)
  })
})

describe("slugify", () => {
  it("strips the extension and unsafe characters", () => {
    expect(slugify("My Book.pdf")).toBe("My Book")
    expect(slugify('a/b:c*d?e"f<g>h|i.pdf')).toBe("a-b-c-d-e-f-g-h-i")
  })

  it("collapses whitespace and trims", () => {
    expect(slugify("  spaced   out  .pdf")).toBe("spaced out")
  })

  it("falls back when nothing usable remains", () => {
    expect(slugify("///")).toBe("book")
    expect(slugify("", "fallback")).toBe("fallback")
  })

  it("caps the length", () => {
    expect(slugify("x".repeat(500)).length).toBeLessThanOrEqual(80)
  })

  it("keeps non-ASCII titles intact", () => {
    expect(slugify("经济法基础2024.pdf")).toBe("经济法基础2024")
  })
})

describe("packageFileName", () => {
  it("combines a title slug with a short uid", () => {
    expect(packageFileName("My Book.pdf", "abcdef1234567890")).toBe("My Book-abcdef12.lbook")
  })
})
