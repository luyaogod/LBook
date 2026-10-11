import { describe, expect, it } from "vitest"
import {
  arrayElements,
  arrayLength,
  decodeString,
  encodeString,
  objectMembers,
  valueRangeOf,
  type ByteRange,
} from "../../../src/main/lbook/fieldRange"

/**
 * The field locator is the one piece of the editing path that can silently corrupt a
 * book: being one byte out does not throw, it writes over the wrong thing. So the
 * tests here lean on the nasty inputs — the literals a search would trip over, escapes,
 * multi-byte characters — rather than on the happy path alone.
 */

function bytes(text: string): Buffer {
  return Buffer.from(text, "utf8")
}

/** The whole document as one range. */
function all(buffer: Buffer): ByteRange {
  return { start: 0, end: buffer.length }
}

function read(buffer: Buffer, range: ByteRange): string {
  return buffer.subarray(range.start, range.end).toString("utf8")
}

/** A page element shaped like PaddleOCR's, with real content. */
const PAGE = JSON.stringify({
  prunedResult: {
    width: 1224,
    height: 1584,
    parsing_res_list: [
      { block_label: "text", block_content: "第一段", block_bbox: [1, 2, 3, 4] },
      {
        block_label: "table",
        block_content: '<table><tr><td>a</td></tr></table>',
        block_bbox: [5, 6, 7, 8],
      },
    ],
  },
  markdown: { text: "# 标题\n\n正文", images: {} },
})

describe("objectMembers", () => {
  it("finds the members of an object and their value ranges", () => {
    const buffer = bytes('{"a": 1, "b": "two", "c": {"d": 3}}')
    const members = objectMembers(buffer, all(buffer))

    expect([...members.keys()]).toEqual(["a", "b", "c"])
    expect(read(buffer, members.get("a")!)).toBe("1")
    expect(read(buffer, members.get("b")!)).toBe('"two"')
    expect(read(buffer, members.get("c")!)).toBe('{"d": 3}')
  })

  it("does not mistake a nested key for one of its own", () => {
    // The point of scanning rather than searching: `block_content` here is inside the
    // nested object, and the outer object has no such member.
    const buffer = bytes('{"markdown": {"block_content": "x"}, "other": 1}')
    const members = objectMembers(buffer, all(buffer))
    expect(members.has("block_content")).toBe(false)
    expect([...members.keys()]).toEqual(["markdown", "other"])
  })

  it("survives whitespace, newlines and an empty object", () => {
    const buffer = bytes('{\n  "a"\t:\n  "multi\\nline",\n\n  "b": []\n}')
    const members = objectMembers(buffer, all(buffer))
    expect(decodeString(buffer, members.get("a")!)).toBe("multi\nline")
    expect(read(buffer, members.get("b")!)).toBe("[]")
    expect(objectMembers(bytes("{}"), all(bytes("{}"))).size).toBe(0)
  })
})

describe("arrayElements", () => {
  it("splits an array into its elements, skipping nested ones whole", () => {
    const buffer = bytes('[1, {"a": [2, 3]}, "x", null]')
    const elements = arrayElements(buffer, all(buffer))
    expect(elements.map((element) => read(buffer, element))).toEqual([
      "1",
      '{"a": [2, 3]}',
      '"x"',
      "null",
    ])
    expect(arrayLength(buffer, all(buffer))).toBe(4)
  })

  it("handles commas and brackets inside strings", () => {
    // A comma inside a string is not a separator; neither is a bracket.
    const buffer = bytes('["a, b", "c [d]", "e}"]')
    expect(arrayElements(buffer, all(buffer)).map((element) => read(buffer, element))).toEqual([
      '"a, b"',
      '"c [d]"',
      '"e}"',
    ])
  })

  it("counts nothing in an empty array", () => {
    expect(arrayLength(bytes("[]"), all(bytes("[]")))).toBe(0)
  })
})

describe("valueRangeOf", () => {
  it("finds a block's content by index", () => {
    const buffer = bytes(PAGE)
    const entry = { start: 0, end: buffer.length }

    const first = valueRangeOf(buffer, entry, [
      { key: "prunedResult" },
      { key: "parsing_res_list", index: 0 },
      { key: "block_content" },
    ])
    const second = valueRangeOf(buffer, entry, [
      { key: "prunedResult" },
      { key: "parsing_res_list", index: 1 },
      { key: "block_content" },
    ])

    expect(decodeString(buffer, first!)).toBe("第一段")
    expect(decodeString(buffer, second!)).toBe('<table><tr><td>a</td></tr></table>')
    // And the range is exactly the literal, quotes included.
    expect(read(buffer, first!)).toBe('"第一段"')
  })

  it("finds the page's markdown text", () => {
    const buffer = bytes(PAGE)
    const range = valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "text" }])
    expect(decodeString(buffer, range!)).toBe("# 标题\n\n正文")
  })

  it("returns null for anything that is not there", () => {
    const buffer = bytes(PAGE)
    expect(valueRangeOf(buffer, all(buffer), [{ key: "nope" }])).toBeNull()
    expect(
      valueRangeOf(buffer, all(buffer), [
        { key: "prunedResult" },
        { key: "parsing_res_list", index: 99 },
        { key: "block_content" },
      ]),
    ).toBeNull()
    expect(
      valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "nope" }]),
    ).toBeNull()
  })

  it("is not fooled by the key's name appearing inside a value", () => {
    // The case that makes a search-based locator wrong: the *content* contains the
    // literal `"block_content":` followed by text. A structural scan only ever treats
    // a quoted run as a key when the object's syntax says so.
    const buffer = bytes(
      JSON.stringify({
        prunedResult: {
          parsing_res_list: [
            { block_content: '"block_content": "not a key, just text"', block_bbox: [1, 2, 3, 4] },
            { block_content: "second block", block_bbox: [5, 6, 7, 8] },
          ],
        },
      }),
    )

    const first = valueRangeOf(buffer, all(buffer), [
      { key: "prunedResult" },
      { key: "parsing_res_list", index: 0 },
      { key: "block_content" },
    ])
    expect(decodeString(buffer, first!)).toBe('"block_content": "not a key, just text"')

    // And the second block is found by index, not by counting occurrences of the name.
    const second = valueRangeOf(buffer, all(buffer), [
      { key: "prunedResult" },
      { key: "parsing_res_list", index: 1 },
      { key: "block_content" },
    ])
    expect(decodeString(buffer, second!)).toBe("second block")
  })

  it("handles escaped quotes, backslashes and unicode escapes", () => {
    const value = 'he said "hi\\there"\n\tand left \u00e9'
    const buffer = bytes(JSON.stringify({ markdown: { text: value } }))
    const range = valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "text" }])
    expect(decodeString(buffer, range!)).toBe(value)
  })

  it("handles a value that ends with a backslash-escaped quote", () => {
    const value = 'ends with a quote\\"'
    const buffer = bytes('{"markdown":{"text":' + JSON.stringify(value) + '}}')
    const range = valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "text" }])
    expect(decodeString(buffer, range!)).toBe(value)
  })

  it("handles multi-byte characters straddling nothing in particular", () => {
    // Chinese and an emoji: the ranges are byte offsets, so a naive character count
    // would be three bytes out per character.
    const value = "中文 🀄 emoji 😀"
    const buffer = bytes(JSON.stringify({ markdown: { text: value } }))
    const range = valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "text" }])
    expect(read(buffer, range!)).toBe(JSON.stringify(value))
    expect(decodeString(buffer, range!)).toBe(value)
  })
})

describe("encodeString", () => {
  it("round-trips through decodeString", () => {
    for (const value of ["", "plain", 'quotes "inside"', "换行\n与\t制表", '{"json": "looking"}']) {
      const literal = encodeString(value)
      expect(decodeString(literal, all(literal))).toBe(value)
    }
  })

  it("produces a literal a JSON string value can be replaced with", () => {
    // The whole write path rests on this: a substitution of one string literal for
    // another cannot change the document's structure.
    const buffer = bytes('{"markdown":{"text":"old"}}')
    const range = valueRangeOf(buffer, all(buffer), [{ key: "markdown" }, { key: "text" }])!
    const replaced = Buffer.concat([
      buffer.subarray(0, range.start),
      encodeString('new "value"'),
      buffer.subarray(range.end),
    ])
    expect(JSON.parse(replaced.toString("utf8"))).toEqual({ markdown: { text: 'new "value"' } })
  })
})
