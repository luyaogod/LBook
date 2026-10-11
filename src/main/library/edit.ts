import fs from "node:fs"
import {
  decodeString,
  encodeString,
  valueRangeOf,
  type ByteRange,
  type PathStep,
} from "../lbook/fieldRange"
import { scanPageSpans } from "../lbook/offsetIndex"
import type { WriteOutcome } from "./create"
import type { Library } from "./library"

/**
 * Correcting content: one field of one page, written straight into `ocr.json`.
 *
 * The whole design rests on a property that is easy to state and worth protecting:
 * **the only bytes this module ever writes are one JSON string literal.** It finds the
 * byte range of a value (`fieldRange.ts`), replaces exactly those bytes, and leaves
 * every other byte of the file alone — measured at 7.5–8.5ms on the largest book here,
 * with the bytes before and after the edit byte-identical (`npm run probe:edit`).
 *
 * Consequences that follow from that, rather than from discipline:
 *
 * - **Coordinates cannot be corrupted.** `block_bbox` is not reachable: the two fields
 *   that can be edited are `parsing_res_list[i].block_content` and `markdown.text`.
 * - **The structure cannot be broken.** Replacing one string literal with another
 *   leaves the document's shape untouched, so a content edit cannot make the file
 *   unparseable (A7's spirit: the file stays the file PaddleOCR wrote).
 * - **A page is written at a time**, in page-flip mode, because the page is the file's
 *   unit and the reader's context (`.agents/plan/04-phase4-content-edit.md`).
 *
 * What this module deliberately does *not* do: re-serialize a page, touch the PDF, or
 * sync the two readings of a page with each other (A18 — correcting a block does not
 * rewrite the Markdown, and vice versa).
 */

/** The two fields that can be corrected. */
export type EditableField = "block_content" | "markdown"

export interface WriteFieldInput {
  uid: string
  /** 0-based, i.e. the array index — the file's own numbering (A8). */
  pageIndex: number
  field: EditableField
  /** Which block, for `block_content`. */
  blockIndex?: number
  value: string
  /**
   * What the editor loaded. If the file no longer holds this, somebody else has
   * changed that field since the editor was opened and the write is refused.
   *
   * Compared as a *decoded string* rather than by offset, so a change earlier in the
   * file (which shifts every later offset) does not look like a conflict — and a real
   * change to this very field does, wherever it moved to.
   */
  baseValue?: string
}

export interface WriteFieldResult {
  /** Characters in the old value (not bytes: this is what the reader sees). */
  charsBefore: number
  charsAfter: number
  /** How much longer (+) or shorter (−) the file became. */
  delta: number
  pageCount: number
}

/** Page numbers are 1-based at the edges of the app; the array is 0-based (A8). */
function pathFor(input: WriteFieldInput): PathStep[] {
  if (input.field === "markdown") return [{ key: "markdown" }, { key: "text" }]
  if (input.blockIndex === undefined) {
    throw new Error("editing a block needs a blockIndex")
  }
  return [
    { key: "prunedResult" },
    { key: "parsing_res_list", index: input.blockIndex },
    { key: "block_content" },
  ]
}

/** The byte range of the field inside the page element, or null when it is not there. */
function locate(bytes: Buffer, input: WriteFieldInput): ByteRange | null {
  return valueRangeOf(bytes, { start: 0, end: bytes.length }, pathFor(input))
}

/**
 * Replaces one field's bytes in a copy of the file, then moves the copy into place.
 *
 * Copy-then-rename rather than a write in place: the original is never in a partially
 * written state, so a crash (or a full disk) cannot leave a book whose `ocr.json` is
 * half old and half new. The cost is a copy of `ocr.json` — the largest is 7.9MB here,
 * and the PDF is never involved.
 */
function spliceFile(target: string, absolute: ByteRange, replacement: Buffer): void {
  const staging = `${target}.incoming`
  try {
    fs.copyFileSync(target, staging)
    const current = fs.readFileSync(staging)
    fs.writeFileSync(
      staging,
      Buffer.concat([
        current.subarray(0, absolute.start),
        replacement,
        current.subarray(absolute.end),
      ]),
    )
    fs.renameSync(staging, target)
  } catch (error) {
    fs.rmSync(staging, { force: true })
    throw error
  }
}

/**
 * Writes one corrected field.
 *
 * The order is deliberate: locate, check against what the editor loaded, splice, then
 * **read the result back** and confirm both that the field holds the new value and
 * that the book still has the same number of pages. An edit that cannot be read back
 * is an edit that did not happen.
 */
export async function writeField(
  library: Library,
  input: WriteFieldInput,
): Promise<WriteOutcome<WriteFieldResult>> {
  const doc = await library.get(input.uid)
  if (!doc) return { ok: false, error: "this book is no longer in the library" }

  try {
    // 1-based for the reader, 0-based in the file (A8).
    const { start, bytes } = await library.pageRange(input.uid, input.pageIndex + 1)
    const range = locate(bytes, input)
    if (range === null) {
      return {
        ok: false,
        error:
          input.field === "markdown"
            ? "this page has no markdown text to edit"
            : `this page has no block ${input.blockIndex}`,
      }
    }

    const current = decodeString(bytes, range)
    if (current === null) {
      return { ok: false, error: "the field to edit is not a string, so this build will not touch it" }
    }
    if (input.baseValue !== undefined && current !== input.baseValue) {
      // Somebody (the reader in another program, or a previous edit) changed this
      // field since the editor opened. Overwriting silently would lose their change.
      return {
        ok: false,
        error: "this text has changed since the editor was opened; reopen it to see the current version",
      }
    }
    if (current === input.value) {
      return {
        ok: true,
        value: {
          charsBefore: current.length,
          charsAfter: current.length,
          delta: 0,
          pageCount: doc.page_count,
        },
      }
    }

    const replacement = encodeString(input.value)
    spliceFile(await ocrPathOf(library, input.uid), {
      start: start + range.start,
      end: start + range.end,
    }, replacement)

    // The file changed under us: its length moved, so every span after the edit is out
    // of date. Dropping the cache before reading back is what makes the read-back read
    // the file as it now is rather than the index as it was.
    library.refresh()

    // Read the result back: the field holds what was asked for, and the array still
    // has as many pages as it did (a content edit cannot change that, and this is
    // where we would find out if it somehow had).
    const scanned = await scanPageSpans(await ocrPathOf(library, input.uid))
    const pageCount = scanned.spans.length
    const after = await library.pageRange(input.uid, input.pageIndex + 1)
    const rangeAfter = locate(after.bytes, input)
    const readBack = rangeAfter === null ? null : decodeString(after.bytes, rangeAfter)
    if (readBack !== input.value) {
      return { ok: false, error: "the edit could not be read back; the file was left as it was" }
    }
    if (pageCount !== doc.page_count) {
      return {
        ok: false,
        error: `the edit changed the page count (${doc.page_count} → ${pageCount}), which a content edit must not do`,
      }
    }

    return {
      ok: true,
      value: {
        charsBefore: current.length,
        charsAfter: input.value.length,
        delta: replacement.length - (range.end - range.start),
        pageCount,
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The OCR file of a book, for the splices above. */
async function ocrPathOf(library: Library, uid: string): Promise<string> {
  const file = await library.resolveFile(uid, "ocr")
  if (file === null) throw new Error("this book's OCR file is not there any more")
  return file
}

/** The current value of an editable field, so an editor can be opened on it. */
export async function readField(
  library: Library,
  uid: string,
  pageIndex: number,
  field: EditableField,
  blockIndex?: number,
): Promise<WriteOutcome<{ value: string | null }>> {
  const doc = await library.get(uid)
  if (!doc) return { ok: false, error: "this book is no longer in the library" }
  try {
    const { bytes } = await library.pageRange(uid, pageIndex + 1)
    const range = locate(bytes, { uid, pageIndex, field, blockIndex, value: "" })
    if (range === null) return { ok: true, value: { value: null } }
    return { ok: true, value: { value: decodeString(bytes, range) } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
