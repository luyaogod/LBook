import { describe, expect, it } from "vitest"
import {
  checkOcrPage,
  summaryOf,
  validateBook,
  worstLevel,
  type BookDigest,
} from "../../../src/shared/validateBook"
import { BOOK_FORMAT_VERSION, writeBookMeta } from "../../../src/shared/bookFile"

/**
 * The validator is the one piece of code that runs over files the user edited by
 * hand, so the rule it must never break is "report, never throw": a validator that
 * crashes takes the library listing down with it.
 */

function metaText(overrides: Record<string, unknown> = {}): unknown {
  return JSON.parse(
    writeBookMeta({
      formatVersion: BOOK_FORMAT_VERSION,
      uid: "uid-1",
      title: "Test",
      pageCount: 3,
      ocrFile: "ocr.json",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    }),
  )
}

function digest(overrides: Partial<BookDigest> = {}): BookDigest {
  return {
    dir: "/books/test",
    files: ["meta.json", "ocr.json", "book.pdf"],
    meta: { kind: "parsed", raw: metaText() },
    ocr: {
      kind: "facts",
      facts: { fileBytes: 1000, pageCount: 3, complete: true, hasArray: true, findings: [], wholeFile: { arrayLength: 3 } },
    },
    toc: { kind: "missing" },
    hasPdf: true,
    pdfHeader: "%PDF-1.7",
    ...overrides,
  }
}

describe("a healthy book", () => {
  it("has nothing to report", () => {
    expect(validateBook(digest())).toEqual([])
    expect(worstLevel([])).toBeNull()
    expect(summaryOf([])).toBeNull()
  })

  it("needs no toc.json", () => {
    expect(validateBook(digest({ toc: { kind: "missing" } }))).toEqual([])
  })
})

describe("meta.json", () => {
  it("reports a missing one as an error on the folder", () => {
    const issues = validateBook(digest({ meta: { kind: "missing" }, files: [] }))
    expect(worstLevel(issues)).toBe("error")
    expect(issues[0].file).toBe("meta.json")
    expect(issues[0].message).toMatch(/no meta\.json/)
  })

  it("reports a JSON syntax error with the parser's own message", () => {
    const issues = validateBook(digest({ meta: { kind: "unparseable", error: "Unexpected token" } }))
    expect(issues[0].message).toMatch(/not valid JSON: Unexpected token/)
  })

  it("passes the shape rules through from bookFile", () => {
    const issues = validateBook(digest({ meta: { kind: "parsed", raw: { formatVersion: 1 } } }))
    expect(issues[0].level).toBe("error")
    expect(issues[0].message).toMatch(/no uid/)
  })

  it("reports an ocrFile that is not in the folder", () => {
    const issues = validateBook(
      digest({ meta: { kind: "parsed", raw: metaText({ ocrFile: "missing.json" }) } }),
    )
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/points at missing\.json/)
  })

  it("warns when the page count disagrees with the OCR file", () => {
    // A page is an array index (A8), so a shorter array means the last pages read as
    // empty and a longer one means pages nothing can reach.
    const issues = validateBook(
      digest({
        meta: { kind: "parsed", raw: metaText({ pageCount: 5 }) },
        ocr: {
          kind: "facts",
          facts: { fileBytes: 1000, pageCount: 3, complete: true, hasArray: true, findings: [], wholeFile: { arrayLength: 3 } },
        },
      }),
    )
    expect(worstLevel(issues)).toBe("warn")
    expect(issues[0].message).toMatch(/says 5 pages but the OCR file has 3/)
  })

  it("says nothing about the page count when the scan was shallow", () => {
    const issues = validateBook(
      digest({
        meta: { kind: "parsed", raw: metaText({ pageCount: 5 }) },
        ocr: {
          kind: "facts",
          facts: { fileBytes: 1000, pageCount: 1, complete: false, hasArray: true, findings: [], wholeFile: null },
        },
      }),
    )
    expect(worstLevel(issues)).toBe("warn")
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/not read in full/)
    expect(issues.map((issue) => issue.message).join(" ")).not.toMatch(/says 5 pages/)
  })
})

describe("ocr.json", () => {
  it("tells 'no array' apart from 'an empty array'", () => {
    const none = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: { fileBytes: 10, pageCount: 0, complete: true, hasArray: false, findings: [], wholeFile: null },
        },
      }),
    )
    expect(none[0].message).toMatch(/no layoutParsingResults array/)

    const empty = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: { fileBytes: 10, pageCount: 0, complete: true, hasArray: true, findings: [], wholeFile: null },
        },
      }),
    )
    expect(empty[0].message).toMatch(/empty layoutParsingResults array/)
  })

  it("reports an unreadable file and a missing one differently", () => {
    expect(validateBook(digest({ ocr: { kind: "missing" } }))[0].message).toMatch(/is not in this folder/)
    expect(validateBook(digest({ ocr: { kind: "unreadable", error: "EACCES" } }))[0].message).toMatch(
      /could not be read: EACCES/,
    )
  })

  it("passes page findings through with their byte offset and JSON path", () => {
    const issues = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: {
            fileBytes: 900,
            pageCount: 3,
            complete: true,
            hasArray: true,
            wholeFile: null,
            findings: [
              {
                pageIndex: 300,
                offset: 123456,
                message: "page 301 is not an object",
                jsonPath: "layoutParsingResults[300]",
              },
            ],
          },
        },
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      level: "warn",
      offset: 123456,
      jsonPath: "layoutParsingResults[300]",
    })
  })
})

describe("book.pdf", () => {
  it("reports a missing PDF", () => {
    const issues = validateBook(digest({ hasPdf: false, pdfHeader: null }))
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(/book\.pdf is missing/)
  })

  it("reports a file that is not a PDF", () => {
    const issues = validateBook(digest({ pdfHeader: "<!DOCTYPE html>" }))
    expect(issues[0].message).toMatch(/does not start with %PDF-/)
  })

  it("says nothing when the header could not be read at all", () => {
    // An unreadable header is not proof of a bad PDF.
    expect(validateBook(digest({ pdfHeader: null }))).toEqual([])
  })
})

describe("toc.json", () => {
  it("reuses the toc parser's message", () => {
    const issues = validateBook(digest({ toc: { kind: "text", text: '{"version":1,"nodes":[{}]}' } }))
    expect(worstLevel(issues)).toBe("warn")
    expect(issues[0].message).toMatch(/toc\.json is not a valid table of contents/)
  })

  it("accepts a valid outline", () => {
    const issues = validateBook(
      digest({ toc: { kind: "text", text: '{"version":1,"nodes":[{"title":"One","page":1}]}' } }),
    )
    expect(issues).toEqual([])
  })

  it("reports a file that is not JSON at all", () => {
    const issues = validateBook(digest({ toc: { kind: "text", text: "{ oops" } }))
    expect(issues[0].message).toMatch(/not a valid table of contents/)
  })
})

describe("the file as a whole", () => {
  it("warns when the file cannot be parsed in one piece but every page reads", () => {
    // The case a byte-range reader cannot see: a missing comma between two pages.
    // Each page is valid JSON; the file is not, and other tools will refuse it.
    const issues = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: {
            fileBytes: 1000,
            pageCount: 3,
            complete: true,
            hasArray: true,
            findings: [],
            wholeFile: { error: "Expected ',' or ']' after array element in JSON at position 4282014", offset: 4282014 },
          },
        },
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ level: "warn", file: "ocr.json", offset: 4282014 })
    expect(issues[0].message).toMatch(/cannot be parsed as a whole/)
    expect(issues[0].message).toMatch(/other tools will refuse/)
  })

  it("says nothing when the whole-file parse agrees with the scanner", () => {
    expect(validateBook(digest())).toEqual([])
  })

  it("shouts when the scanner and the parser disagree about the page count", () => {
    // That combination means this app is reading the file wrong, which is worse than
    // anything the file itself could be doing.
    const issues = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: {
            fileBytes: 1000,
            pageCount: 3,
            complete: true,
            hasArray: true,
            findings: [],
            wholeFile: { arrayLength: 4 },
          },
        },
      }),
    )
    expect(issues[0].level).toBe("error")
    expect(issues[0].message).toMatch(/bug in LBook/)
  })

  it("does not mention a whole-file parse that was not attempted", () => {
    const issues = validateBook(
      digest({
        ocr: {
          kind: "facts",
          facts: {
            fileBytes: 1000,
            pageCount: 1,
            complete: false,
            hasArray: true,
            findings: [],
            wholeFile: null,
          },
        },
      }),
    )
    expect(issues.map((issue) => issue.message).join(" ")).not.toMatch(/parsed as a whole/)
  })
})

describe("checkOcrPage", () => {
  it("accepts a well-formed page", () => {
    expect(
      checkOcrPage(
        {
          prunedResult: {
            width: 1224,
            parsing_res_list: [{ block_bbox: [1, 2, 3, 4], block_content: "hi" }],
          },
          markdown: { text: "# hi" },
        },
        0,
        100,
      ),
    ).toEqual([])
  })

  it("accepts a page with nothing in it", () => {
    // PaddleOCR leaves fields out; a page with no blocks is a page, not a problem.
    expect(checkOcrPage({}, 0, 0)).toEqual([])
    expect(checkOcrPage({ prunedResult: {} }, 0, 0)).toEqual([])
  })

  it("reports an element that is not an object, naming the page", () => {
    const findings = checkOcrPage("nope", 299, 5000)
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toMatch(/page 300 is not an object/)
    expect(findings[0]).toMatchObject({ pageIndex: 299, offset: 5000 })
  })

  it("reports a parsing_res_list that is not an array", () => {
    const findings = checkOcrPage({ prunedResult: { parsing_res_list: "nope" } }, 4, 10)
    expect(findings[0].jsonPath).toBe("layoutParsingResults[4].prunedResult.parsing_res_list")
  })

  it("reports a block_bbox that is not four numbers, naming the block", () => {
    const findings = checkOcrPage({ prunedResult: { parsing_res_list: [{ block_bbox: [1, 2, 3] }] } }, 1, 0)
    expect(findings[0].message).toMatch(/page 2 block 0 has a block_bbox that is not four numbers/)
  })

  it("accepts a block with no bbox at all", () => {
    expect(checkOcrPage({ prunedResult: { parsing_res_list: [{ block_label: "text" }] } }, 0, 0)).toEqual([])
  })

  it("never throws, whatever it is handed", () => {
    const nasty: unknown[] = [
      null,
      undefined,
      0,
      NaN,
      "",
      [],
      [1, 2],
      { prunedResult: null },
      { prunedResult: [] },
      { prunedResult: { parsing_res_list: [null, 1, "x"] } },
      { prunedResult: { parsing_res_list: [{ block_bbox: null }] } },
      { prunedResult: { parsing_res_list: [{ block_bbox: [{}, {}] }] } },
      { prunedResult: { parsing_res_list: [{ block_bbox: [NaN, 1, 2, 3] }] } },
    ]
    for (const value of nasty) {
      expect(() => checkOcrPage(value, 0, 0)).not.toThrow()
    }
  })
})

describe("the validator never throws", () => {
  it("survives a digest made entirely of nonsense", () => {
    const nasty: Array<Partial<BookDigest>> = [
      { meta: { kind: "parsed", raw: null } },
      { meta: { kind: "parsed", raw: [] } },
      { meta: { kind: "parsed", raw: { uid: 1, pageCount: "3", ocrFile: {} } } },
      { toc: { kind: "text", text: "" } },
      { toc: { kind: "text", text: "[]" } },
      { ocr: { kind: "facts", facts: { fileBytes: 0, pageCount: 0, complete: true, hasArray: true, findings: [], wholeFile: null } } },
    ]
    for (const overrides of nasty) {
      expect(() => validateBook(digest(overrides))).not.toThrow()
    }
  })

  it("summarises with the first error, not the first warning", () => {
    const issues = validateBook(digest({ toc: { kind: "text", text: "{ oops" }, hasPdf: false }))
    // The PDF error comes after the toc warning in the rule order, but the summary
    // has to lead with what stops the book being readable.
    expect(summaryOf(issues)).toMatch(/book\.pdf is missing/)
  })
})
