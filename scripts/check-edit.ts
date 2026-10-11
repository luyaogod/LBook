import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { createLedgerStore } from "../src/main/library/ledger"
import { createLibrary } from "../src/main/library/library"
import { writeField } from "../src/main/library/edit"
import { createProgressStore } from "../src/main/progress"
import { scanPageSpans } from "../src/main/lbook/offsetIndex"

/**
 * End-to-end check of the editing path on a real book.
 *
 *   npm run check:edit              # the largest book in the library
 *   npm run check:edit -- --book 经济法
 *
 * It copies a real book folder into a temp directory (so the real one is only read),
 * opens it through the real library, corrects a block and a page's Markdown through the
 * real `writeField`, and checks what the design promises:
 *
 *   - the field reads back with the new text, and its coordinates are untouched;
 *   - parsed, the page differs in **exactly one field** — everything else deep-equal;
 *   - the page count is unchanged and every page still parses;
 *   - correcting a block leaves the page's Markdown alone, and vice versa (A18);
 *   - a write based on text the editor loaded *before* a change is refused.
 *
 * The unit tests cover the same ground on fixtures; this is the one that says the
 * locator and the splice work on the megabytes PaddleOCR actually produces.
 */

const USER_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "LBook")
const work = path.join(os.tmpdir(), "lbook-edit-e2e")

const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex")

function booksFromLedger(): string[] {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(USER_DATA, "library.json"), "utf8")) as {
      books?: Array<{ path?: string }>
    }
    let root = path.join(os.homedir(), "Documents", "LBook Library")
    try {
      const config = JSON.parse(fs.readFileSync(path.join(USER_DATA, "config.json"), "utf8")) as {
        libraryDir?: string | null
      }
      if (config.libraryDir) root = config.libraryDir
    } catch {
      // The default, matching src/main/paths.ts.
    }
    return (ledger.books ?? [])
      .map((book) => book.path ?? "")
      .filter((value) => value !== "")
      .map((value) => (path.isAbsolute(value) ? value : path.resolve(root, value)))
      .filter((dir) => fs.existsSync(path.join(dir, ".lbook", "ocr.json")))
  } catch {
    return []
  }
}

/** How much of the file changed, and where. */
function diff(before: Buffer, after: Buffer) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++
  }
  return { prefix, changedBefore: before.length - prefix - suffix, changedAfter: after.length - prefix - suffix }
}

/** Reads the page element that the byte range `span` covers. */
function elementAt(file: string, span: { start: number; end: number }): Record<string, never> {
  const handle = fs.openSync(file, "r")
  try {
    const buffer = Buffer.alloc(span.end - span.start)
    fs.readSync(handle, buffer, 0, buffer.length, span.start)
    return JSON.parse(buffer.toString("utf8")) as Record<string, never>
  } finally {
    fs.closeSync(handle)
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const filter = argv.includes("--book") ? argv[argv.indexOf("--book") + 1] : undefined

  const candidates = booksFromLedger()
    .map((dir) => ({ dir, size: fs.statSync(path.join(dir, ".lbook", "ocr.json")).size }))
    .sort((a, b) => b.size - a.size)
  const chosen = (filter ? candidates.find((c) => c.dir.includes(filter)) : candidates[0]) ?? candidates[0]
  if (!chosen) {
    console.error("no book found; add one in the app first")
    process.exitCode = 1
    return
  }

  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(path.join(work, "library"), { recursive: true })

  const name = path.basename(chosen.dir)
  const copy = path.join(work, "library", name)
  fs.mkdirSync(path.join(copy, ".lbook"), { recursive: true })
  for (const file of ["meta.json", "ocr.json"]) {
    fs.copyFileSync(path.join(chosen.dir, ".lbook", file), path.join(copy, ".lbook", file))
  }

  const library = createLibrary({
    ledger: createLedgerStore({ file: path.join(work, "library.json"), root: path.join(work, "library") }),
    progress: createProgressStore({ file: path.join(work, "progress.json") }),
  })

  const opened = await library.open(copy)
  if (!opened.ok) throw new Error(opened.error)
  const uid = opened.doc.uid
  const ocrPath = path.join(copy, ".lbook", "ocr.json")
  const pageIndex = Math.min(300, opened.doc.page_count - 1)

  console.log(
    `${opened.doc.title}: ${opened.doc.page_count} pages, ${(fs.statSync(ocrPath).size / 1048576).toFixed(1)}MB\n`,
  )

  // ---- a block, in the middle of the book ------------------------------------
  const page = await library.getPage(uid, pageIndex + 1)
  const blockIndex = 0
  const blockBefore = page?.blocks[blockIndex]
  const baseValue = blockBefore?.block_content ?? ""
  const corrected = `${baseValue}（这一句是人工修正后追加的）`

  console.log(
    `page ${pageIndex + 1} block ${blockIndex}: ${JSON.stringify(baseValue.slice(0, 30))}…  bbox ${JSON.stringify(blockBefore?.block_bbox)}`,
  )

  const fileBefore = fs.readFileSync(ocrPath)
  const spansBefore = await scanPageSpans(ocrPath)
  const started = Date.now()
  const outcome = await writeField(library, {
    uid,
    pageIndex,
    field: "block_content",
    blockIndex,
    value: corrected,
    baseValue,
  })
  const elapsed = Date.now() - started
  const fileAfter = fs.readFileSync(ocrPath)

  if (!outcome.ok) {
    console.error(`writeField failed: ${outcome.error}`)
    process.exitCode = 1
    return
  }

  const changed = diff(fileBefore, fileAfter)
  const pageAfter = await library.getPage(uid, pageIndex + 1)
  const blockAfter = pageAfter?.blocks[blockIndex]

  // Parsed, the page must differ in exactly the one field.
  // The old element has to be parsed from the old bytes: the new file is 42 bytes
  // longer at that point, so the old range would cut the element in half — which is
  // itself a sign the edit landed inside this page and nowhere else.
  const parsedBefore = JSON.parse(
    fileBefore.subarray(spansBefore.spans[pageIndex].start, spansBefore.spans[pageIndex].end).toString("utf8"),
  ) as Record<string, unknown>
  const parsedAfter = elementAt(ocrPath, (await scanPageSpans(ocrPath)).spans[pageIndex])
  const expectedBefore = JSON.parse(JSON.stringify(parsedBefore)) as {
    prunedResult: { parsing_res_list: Array<{ block_content: string }> }
  }
  const expectedAfter = JSON.parse(JSON.stringify(parsedAfter)) as {
    prunedResult: { parsing_res_list: Array<{ block_content: string }> }
  }
  // Normalise both to the *old* text: whatever is left differing is a change nothing
  // in this feature is allowed to make.
  expectedAfter.prunedResult.parsing_res_list[blockIndex].block_content = baseValue
  expectedBefore.prunedResult.parsing_res_list[blockIndex].block_content = baseValue

  const checks: Array<[string, boolean, string]> = [
    ["the block reads back with the new text", blockAfter?.block_content === corrected, `${elapsed}ms, delta ${outcome.value.delta}B`],
    ["its bbox is untouched", JSON.stringify(blockAfter?.block_bbox) === JSON.stringify(blockBefore?.block_bbox), ""],
    ["the page count is unchanged", (await library.get(uid))?.page_count === opened.doc.page_count, ""],
    [
      "parsed, only that one field differs",
      JSON.stringify(expectedBefore) === JSON.stringify(expectedAfter),
      `changed ${changed.changedBefore}B → ${changed.changedAfter}B at byte ${changed.prefix} of ${fileBefore.length}`,
    ],
    [
      "the file grew by exactly the text added",
      changed.changedAfter - changed.changedBefore === Buffer.byteLength("（这一句是人工修正后追加的）"),
      "",
    ],
  ]

  // ---- the page's Markdown, which must not touch the blocks (A18) -------------
  const markdownBefore = pageAfter?.markdown_text ?? ""
  const blocksJson = JSON.stringify(pageAfter?.blocks)
  const markdownOutcome = await writeField(library, {
    uid,
    pageIndex,
    field: "markdown",
    value: `${markdownBefore}\n\n> 人工补注：这一页的 Markdown 也被修正过。`,
    baseValue: markdownBefore,
  })
  const pageFinal = await library.getPage(uid, pageIndex + 1)
  checks.push(
    ["writing the markdown works", markdownOutcome.ok, ""],
    ["the markdown holds the new text", pageFinal?.markdown_text?.includes("人工补注") === true, ""],
    ["the blocks are exactly as they were (A18)", JSON.stringify(pageFinal?.blocks) === blocksJson, ""],
  )

  // ---- a stale editor is refused -------------------------------------------
  const stale = await writeField(library, {
    uid,
    pageIndex,
    field: "block_content",
    blockIndex,
    value: "written from an editor opened before the last change",
    baseValue,
  })
  const staleError = stale.ok ? "" : stale.error
  checks.push(["a write based on the pre-edit text is refused", !stale.ok, staleError])

  // ---- every page still parses ---------------------------------------------
  const spans = (await scanPageSpans(ocrPath)).spans
  let parsed = 0
  for (const span of spans) {
    elementAt(ocrPath, span)
    parsed++
  }
  checks.push([`every page still parses (${parsed}/${spans.length})`, parsed === spans.length, ""])

  console.log("")
  let failed = 0
  for (const [what, ok, detail] of checks) {
    if (!ok) failed++
    console.log(`  ${ok ? "✓" : "✗"} ${what}${detail ? `  — ${detail}` : ""}`)
  }

  console.log(`\n  final file: ${fs.statSync(ocrPath).size} bytes, sha256 ${sha256(ocrPath).slice(0, 16)}…`)
  fs.rmSync(work, { recursive: true, force: true })
  if (failed > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
