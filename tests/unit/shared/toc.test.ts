import { describe, expect, it } from "vitest"
import {
  countTocNodes,
  findActiveTocId,
  flattenToc,
  parseToc,
  tocAncestorIds,
  TOC_FORMAT_VERSION,
} from "../../../src/shared/toc"

const BOOK = {
  version: 1,
  nodes: [
    {
      title: "第一章 总论",
      page: 4,
      printedPage: 1,
      children: [
        { title: "第一节 法律基础", page: 6, printedPage: 3 },
        { title: "第二节 法律主体", page: 20, printedPage: 17 },
      ],
    },
    {
      title: "第二章 会计法律制度",
      page: 32,
      printedPage: 29,
      children: [{ title: "第一节 会计法律制度概述", page: 32, printedPage: 29 }],
    },
  ],
}

describe("parseToc", () => {
  it("accepts the documented shape and keeps printed page numbers", () => {
    const toc = parseToc(BOOK)
    expect(toc.version).toBe(1)
    expect(toc.nodes[0].title).toBe("第一章 总论")
    expect(toc.nodes[0].children?.[1].printedPage).toBe(17)
  })

  it("accepts a bare array as shorthand for { nodes }", () => {
    // A hand-written file naturally starts with '['; refusing it would only
    // send the user looking for a wrapper they do not need.
    const toc = parseToc([{ title: "封面", page: 1 }])
    expect(toc.version).toBe(TOC_FORMAT_VERSION)
    expect(toc.nodes).toHaveLength(1)
  })

  it("defaults a missing version to the current one", () => {
    expect(parseToc({ nodes: [{ title: "A", page: 2 }] }).version).toBe(TOC_FORMAT_VERSION)
  })

  it("refuses a file written by a newer build", () => {
    expect(() => parseToc({ version: TOC_FORMAT_VERSION + 1, nodes: [{ title: "A", page: 1 }] })).toThrow(
      /newer than this build supports/,
    )
  })

  it("names the offending entry when a title is missing", () => {
    expect(() => parseToc({ nodes: [{ title: "A", page: 1 }, { page: 2 }] })).toThrow(/nodes\[1\].*title/)
  })

  it("rejects non-positive and fractional page numbers", () => {
    expect(() => parseToc({ nodes: [{ title: "A", page: 0 }] })).toThrow(/positive whole page number/)
    expect(() => parseToc({ nodes: [{ title: "A", page: 2.5 }] })).toThrow(/positive whole page number/)
  })

  it("rejects a leaf that could never be clicked", () => {
    // Neither a page nor children means the entry does nothing at all.
    expect(() => parseToc({ nodes: [{ title: "空节点" }] })).toThrow(/needs a "page" or a non-empty "children"/)
  })

  it("allows a group heading that only holds children", () => {
    const toc = parseToc({ nodes: [{ title: "上册", children: [{ title: "第一章", page: 1 }] }] })
    expect(toc.nodes[0].page).toBeNull()
  })

  it("caps nesting depth", () => {
    let node: Record<string, unknown> = { title: "leaf", page: 1 }
    for (let i = 0; i < 8; i++) node = { title: `level ${i}`, children: [node] }
    expect(() => parseToc({ nodes: [node] })).toThrow(/may not nest deeper/)
  })

  it("rejects an empty table of contents", () => {
    expect(() => parseToc({ nodes: [] })).toThrow(/no entries/)
    expect(() => parseToc("toc.json")).toThrow(/nodes/)
  })
})

describe("flattenToc", () => {
  it("walks the tree in reading order and numbers ids by position", () => {
    const flat = flattenToc(parseToc(BOOK))
    expect(flat.map((node) => node.id)).toEqual(["0", "0.0", "0.1", "1", "1.0"])
    expect(flat.map((node) => node.depth)).toEqual([1, 2, 2, 1, 2])
    expect(flat[2].printedPage).toBe(17)
  })

  it("returns nothing for a book without a table of contents", () => {
    expect(flattenToc(null)).toEqual([])
  })

  it("counts every entry including nested ones", () => {
    expect(countTocNodes(parseToc(BOOK).nodes)).toBe(5)
  })
})

describe("findActiveTocId", () => {
  const flat = flattenToc(parseToc(BOOK))

  it("returns null before the first entry", () => {
    expect(findActiveTocId(flat, 1)).toBeNull()
  })

  it("marks the entry whose range contains the page", () => {
    // Page 10 falls inside the first section (scan pages 6..19).
    expect(findActiveTocId(flat, 10)).toBe("0.0")
    expect(findActiveTocId(flat, 19)).toBe("0.0")
    expect(findActiveTocId(flat, 25)).toBe("0.1")
  })

  it("prefers the deeper entry when a chapter and its section share a page", () => {
    // Both entries start on scan page 32.
    expect(findActiveTocId(flat, 32)).toBe("1.0")
  })

  it("keeps the last entry active past the end of the book", () => {
    expect(findActiveTocId(flat, 999)).toBe("1.0")
  })
})

describe("tocAncestorIds", () => {
  it("lists every prefix of a dotted id, outermost first", () => {
    expect(tocAncestorIds("2.1.3")).toEqual(["2", "2.1"])
    expect(tocAncestorIds("0")).toEqual([])
  })
})
