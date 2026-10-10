import fs from "node:fs"

/**
 * Random access into one large OCR JSON, page by page.
 *
 * Why this exists: a book's OCR output is **one 8–40 MB JSON file** (PaddleOCR's
 * own, stored verbatim), while the app usually wants "page N". Parsing the whole
 * file costs 36 ms and 46 MB of resident memory for 15.6 MB of JSON, and both
 * grow with the file; reading one page by offset costs 0.1–0.3 ms and its memory
 * does not depend on file size. The measurements are in PLAN.md 4.2 and archived
 * in .agents/plan/baseline.md.
 *
 * Three things are decided here:
 *
 * 1. **Streaming, in chunks**: the whole file is never held in memory. The state
 *    machine is byte-level — `{ } [ ] " \\` are single-byte ASCII and multi-byte
 *    UTF-8 can only appear inside strings, where only `"` and `\\` matter — so
 *    **no carry buffer is needed across chunk boundaries**.
 * 2. **No assumptions about formatting**: only brace depth and string state are
 *    tracked. A user who reformats the file, or an editor that rewrites line
 *    endings, changes nothing but the need to scan again.
 * 3. **A page number is the array index** of `layoutParsingResults`. PaddleOCR's
 *    elements carry no page field, so deleting or inserting one shifts every page
 *    after it — which is why callers must cross-check "pages = meta.pageCount =
 *    PDF page count".
 */

const DEFAULT_CHUNK_BYTES = 1024 * 1024

/**
 * How far the search for the array's opening bracket will read.
 *
 * In a real output the key is within the first few lines; this is only a fallback
 * (the prefix grows eightfold each time). Far simpler than a search state machine
 * with cross-chunk residue, which is the part of this module most likely to be
 * subtly wrong.
 */
const MAX_PREFIX_BYTES = 8 * 1024 * 1024

const KEY = Buffer.from('"layoutParsingResults"')
const OPEN_BRACKET = 0x5b // [
const CLOSE_BRACKET = 0x5d // ]
const OPEN_BRACE = 0x7b // {
const CLOSE_BRACE = 0x7d // }
const QUOTE = 0x22 // "
const BACKSLASH = 0x5c // \

export interface PageSpan {
  readonly start: number
  /** Exclusive: `[start, end)` is exactly this page element's byte range. */
  readonly end: number
}

export interface ScanResult {
  spans: PageSpan[]
  /** Size of the file. */
  fileBytes: number
  /**
   * How many bytes were actually read. With `limit` this is far below
   * `fileBytes` — that is where "the first screen costs a few milliseconds"
   * comes from, and it is what the progressive-reading claim is measured by.
   */
  scannedBytes: number
}

export interface ScanOptions {
  /** Stop after N pages (the first screen only needs the pages it shows). */
  limit?: number
  /** Chunk size. Tests shrink it so small samples land exactly on the boundaries. */
  chunkBytes?: number
}

interface ScanState {
  /** Depth of the array itself: the bracket is not scanned, so this starts at 1. */
  depth: number
  inString: boolean
  escaped: boolean
  /** Absolute offset where the current element starts; -1 when outside one. */
  start: number
}

/**
 * Scans the file and reports every page's byte range.
 *
 * A file without `layoutParsingResults`, or with an empty array, yields no spans
 * and **does not throw**: this is data the user may have edited by hand, and a bad
 * book has to be reported in the library rather than taking the library down.
 */
export async function scanPageSpans(filePath: string, options: ScanOptions = {}): Promise<ScanResult> {
  const chunkBytes = Math.max(64, options.chunkBytes ?? DEFAULT_CHUNK_BYTES)
  const handle = await fs.promises.open(filePath, "r")
  const spans: PageSpan[] = []
  const state: ScanState = { depth: 1, inString: false, escaped: false, start: -1 }
  const scratch = Buffer.allocUnsafe(chunkBytes)
  let scannedBytes = 0

  try {
    const fileBytes = (await handle.stat()).size
    const found = await readArrayStart(handle, fileBytes)
    if (found === null) return { spans, fileBytes, scannedBytes: 0 }
    scannedBytes += found.bytesRead

    // The part of the prefix already in memory is scanned in place instead of
    // being read from disk again: the accounting stays honest (`scannedBytes` is
    // what was really read) and the first screen saves an IO.
    let done = scanBytes(
      found.buf.subarray(found.arrayAt + 1, found.bytesRead),
      state,
      spans,
      found.arrayAt + 1,
      options.limit,
    )
    let position = found.bytesRead

    while (!done && position < fileBytes) {
      const { bytesRead } = await handle.read(scratch, 0, chunkBytes, position)
      if (bytesRead <= 0) break
      scannedBytes += bytesRead
      const buf = bytesRead === chunkBytes ? scratch : scratch.subarray(0, bytesRead)
      done = scanBytes(buf, state, spans, position, options.limit)
      position += bytesRead
    }

    return { spans, fileBytes, scannedBytes }
  } finally {
    await handle.close()
  }
}

/**
 * Reads one range and parses it.
 *
 * Takes an `fd` from the caller (the handle `openBook` keeps) so reading pages in
 * sequence does not reopen the file. `span` must come from this module: that is
 * what guarantees it is a whole element and can be parsed on its own.
 */
export function readSpanAt(fd: number, span: PageSpan): unknown {
  const length = span.end - span.start
  const buf = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, span.start + read)
    if (n <= 0) throw new Error(`short read: wanted ${length} bytes, got ${read}`)
    read += n
  }
  return JSON.parse(buf.toString("utf8"))
}

/**
 * Convenience form: opens and closes the file itself. For a single page that is
 * enough — an open/close pair costs less than the parse it feeds.
 */
export function readSpan(filePath: string, span: PageSpan): unknown {
  const fd = fs.openSync(filePath, "r")
  try {
    return readSpanAt(fd, span)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Reads a prefix and finds the absolute offset of the opening bracket after
 * `layoutParsingResults`.
 *
 * The prefix grows eightfold (64KB -> 512KB -> 4MB -> 8MB) and gives up with null.
 * The buffer comes back with it so the caller can scan it in place instead of
 * reading those bytes twice.
 */
async function readArrayStart(
  handle: fs.promises.FileHandle,
  fileBytes: number,
): Promise<{ arrayAt: number; buf: Buffer; bytesRead: number } | null> {
  let prefix = Math.min(65536, fileBytes)
  for (;;) {
    const buf = Buffer.allocUnsafe(prefix)
    const { bytesRead } = await handle.read(buf, 0, prefix, 0)
    const view = buf.subarray(0, bytesRead)
    const keyAt = view.indexOf(KEY)
    if (keyAt >= 0) {
      const at = view.indexOf(OPEN_BRACKET, keyAt)
      if (at >= 0) return { arrayAt: at, buf, bytesRead }
    }
    if (bytesRead >= fileBytes || prefix >= MAX_PREFIX_BYTES) return null
    prefix = Math.min(prefix * 8, fileBytes, MAX_PREFIX_BYTES)
  }
}

/**
 * The state machine itself. `base` is this chunk's absolute offset in the file,
 * because element starts are recorded in absolute terms. Returns true when the job
 * is done: the array ended, or `limit` elements have been collected.
 */
function scanBytes(
  buf: Buffer,
  state: ScanState,
  spans: PageSpan[],
  base: number,
  limit?: number,
): boolean {
  for (let p = 0; p < buf.length; p++) {
    const c = buf[p]
    if (state.inString) {
      if (state.escaped) state.escaped = false
      else if (c === BACKSLASH) state.escaped = true
      else if (c === QUOTE) state.inString = false
      continue
    }
    if (c === QUOTE) {
      state.inString = true
      continue
    }
    if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      state.depth++
      if (state.depth === 2 && state.start < 0) state.start = base + p
      continue
    }
    if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
      state.depth--
      if (state.depth === 1 && state.start >= 0) {
        spans.push({ start: state.start, end: base + p + 1 })
        state.start = -1
        if (limit !== undefined && spans.length >= limit) return true
      }
      if (state.depth === 0) return true
    }
  }
  return false
}
