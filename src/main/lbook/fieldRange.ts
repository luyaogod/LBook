/**
 * Where a JSON *value* lives in a file, in bytes.
 *
 * The editing design (`.agents/plan/04-phase4-content-edit.md`) writes one string
 * field — a block's `block_content`, or a page's `markdown.text` — and nothing else.
 * To do that it needs the exact byte range of that value inside the page element, so
 * it can replace those bytes and leave the rest of a 7.9MB file alone.
 *
 * **Why a scanner and not a search.** The obvious shortcut is to look for the Nth
 * `"block_content"` in the bytes. It is wrong, and quietly so: a block's *content* is
 * arbitrary text (HTML fragments, code samples, JSON examples in a book about JSON)
 * and may contain that literal itself. A search would then edit the wrong bytes, in
 * the wrong page, and the app would have "corrected" something the reader never
 * touched. So this walks the document the same way `offsetIndex.ts` does — byte by
 * byte, knowing whether it is inside a string — and only treats a quoted run as a key
 * when the structure says it is one.
 *
 * Ranges are `[start, end)`, in absolute file bytes, and for a string value they
 * include the quotes: a replacement is always a full JSON string literal, which is
 * what makes "a content edit cannot break the structure" true by construction.
 */

export interface ByteRange {
  start: number
  end: number
}

/** One step of a path into the document. `index` selects an array element. */
export interface PathStep {
  key: string
  /** For an array value: which element, 0-based. */
  index?: number
}

const QUOTE = 0x22
const BACKSLASH = 0x5c
const OPEN_BRACE = 0x7b
const CLOSE_BRACE = 0x7d
const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d
const COLON = 0x3a
const COMMA = 0x2c

function isSpace(byte: number): boolean {
  // space, tab, LF, CR
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

/**
 * The end of the JSON value starting at `pos` (its first non-space byte).
 *
 * `limit` is the end of the region being scanned; a value that runs past it is
 * reported as `-1`, which the callers treat as "not found" rather than as a range
 * that would cut a document in half.
 */
function valueEnd(bytes: Buffer, pos: number, limit: number): number {
  if (pos >= limit) return -1
  const first = bytes[pos]

  if (first === QUOTE) {
    let i = pos + 1
    while (i < limit) {
      if (bytes[i] === BACKSLASH) i += 2
      else if (bytes[i] === QUOTE) return i + 1
      else i++
    }
    return -1
  }

  if (first === OPEN_BRACE || first === OPEN_BRACKET) {
    let depth = 0
    let i = pos
    while (i < limit) {
      const byte = bytes[i]
      if (byte === QUOTE) {
        i++
        while (i < limit) {
          if (bytes[i] === BACKSLASH) i += 2
          else if (bytes[i] === QUOTE) break
          else i++
        }
        i++
        continue
      }
      if (byte === OPEN_BRACE || byte === OPEN_BRACKET) depth++
      else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return -1
  }

  // A literal: number, true, false, null. Ends at a structural byte.
  let i = pos
  while (i < limit) {
    const byte = bytes[i]
    if (byte === COMMA || byte === CLOSE_BRACE || byte === CLOSE_BRACKET || isSpace(byte)) break
    i++
  }
  return i > pos ? i : -1
}

/**
 * The members of the object occupying `range`, as key → value range.
 *
 * Nested objects and arrays are skipped whole, so a key inside a nested object is not
 * confused with a key of this one.
 */
export function objectMembers(bytes: Buffer, range: ByteRange): Map<string, ByteRange> {
  const members = new Map<string, ByteRange>()
  let i = range.start
  if (bytes[i] !== OPEN_BRACE) return members
  i++

  while (i < range.end) {
    while (i < range.end && isSpace(bytes[i])) i++
    if (i >= range.end || bytes[i] === CLOSE_BRACE) break
    if (bytes[i] === COMMA) {
      i++
      continue
    }
    if (bytes[i] !== QUOTE) break

    const keyEnd = valueEnd(bytes, i, range.end)
    if (keyEnd < 0) break
    const key = decodeString(bytes, { start: i, end: keyEnd })
    i = keyEnd

    while (i < range.end && isSpace(bytes[i])) i++
    if (bytes[i] !== COLON) break
    i++
    while (i < range.end && isSpace(bytes[i])) i++

    const end = valueEnd(bytes, i, range.end)
    if (end < 0) break
    if (key !== null) members.set(key, { start: i, end })
    i = end
  }

  return members
}

/** The elements of the array occupying `range`. Nested arrays are skipped whole. */
export function arrayElements(bytes: Buffer, range: ByteRange): ByteRange[] {
  const elements: ByteRange[] = []
  let i = range.start
  if (bytes[i] !== OPEN_BRACKET) return elements
  i++

  while (i < range.end) {
    while (i < range.end && isSpace(bytes[i])) i++
    if (i >= range.end || bytes[i] === CLOSE_BRACKET) break
    if (bytes[i] === COMMA) {
      i++
      continue
    }

    const end = valueEnd(bytes, i, range.end)
    if (end < 0) break
    elements.push({ start: i, end })
    i = end
  }

  return elements
}

/** The string a JSON string value holds, or null when it is not a string. */
export function decodeString(bytes: Buffer, range: ByteRange): string | null {
  if (bytes[range.start] !== QUOTE) return null
  try {
    const value: unknown = JSON.parse(bytes.subarray(range.start, range.end).toString("utf8"))
    return typeof value === "string" ? value : null
  } catch {
    return null
  }
}

/** The bytes of a JSON string literal for `value` (quotes included, escaped). */
export function encodeString(value: string): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8")
}

/**
 * The byte range of the value a path points at, or null when it is not there.
 *
 * `path` is walked one step at a time, so
 * `[{ key: "parsing_res_list", index: 3 }, { key: "block_content" }]` means "the
 * fourth element of `parsing_res_list`, then its `block_content`".
 */
export function valueRangeOf(bytes: Buffer, range: ByteRange, path: PathStep[]): ByteRange | null {
  let current: ByteRange | null = range

  for (const step of path) {
    if (current === null) return null
    const member = objectMembers(bytes, current).get(step.key)
    if (member === undefined) return null

    if (step.index === undefined) {
      current = member
      continue
    }
    const element: ByteRange | undefined = arrayElements(bytes, member)[step.index]
    if (element === undefined) return null
    current = element
  }

  return current
}

/**
 * How many elements an array has, without parsing it as JSON.
 *
 * Used to report what an edit did (and to notice a page count that moved), where a
 * full `JSON.parse` of a 7.9MB document would be wasteful.
 */
export function arrayLength(bytes: Buffer, range: ByteRange): number {
  return arrayElements(bytes, range).length
}
