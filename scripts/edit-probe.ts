/**
 * What one content edit costs.
 *
 * The editing design writes a *field*, not a page's JSON: find the byte range of one
 * string value inside a page element and replace exactly those bytes, so the rest of
 * the file — every other page, the indentation, the line endings — is untouched. This
 * measures that path on a real book and checks the claim, because "editing is just a
 * few milliseconds" is the sort of thing that should not be asserted from memory.
 *
 *   npm run probe:edit                    # the book with the largest ocr.json
 *   npm run probe:edit -- --book 经济法    # by folder-name fragment
 *   npm run probe:edit -- --dir <书文件夹>
 *
 * It works on copies in a temp directory and deletes them; your library is only read.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { scanPageSpans } from "../src/main/lbook/offsetIndex"

const USER_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "LBook")
const TEMP_ROOT = path.join(os.tmpdir(), "lbook-edit-probe")

const ms = (a: bigint, b: bigint) => Number(b - a) / 1e6

/**
 * The byte range of the `index`-th `"key": "value"` inside `buffer`.
 *
 * A quick scan for this probe. The real implementation should reuse the depth-aware
 * state machine from `offsetIndex.ts` one level down: that one knows when it is inside
 * a string, so a block whose *content* contains the text `"block_content"` cannot be
 * mistaken for a key — which is exactly the sort of input that would make a naive
 * search edit the wrong bytes.
 */
function valueRangeOf(buffer: Buffer, key: string, index: number) {
  const needle = Buffer.from(`"${key}"`)
  let cursor = 0
  let seen = 0

  while (cursor < buffer.length) {
    const at = buffer.indexOf(needle, cursor)
    if (at < 0) return null
    cursor = at + needle.length

    let colon = cursor
    while (colon < buffer.length && /[ \t\r\n]/.test(String.fromCharCode(buffer[colon]))) colon++
    if (buffer[colon] !== 0x3a) continue

    let start = colon + 1
    while (start < buffer.length && /[ \t\r\n]/.test(String.fromCharCode(buffer[start]))) start++

    if (seen < index) {
      seen++
      cursor = start
      continue
    }

    if (buffer[start] === 0x22) {
      let i = start + 1
      while (i < buffer.length) {
        if (buffer[i] === 0x5c) i += 2
        else if (buffer[i] === 0x22) return { start, end: i + 1 }
        else i++
      }
    }
    return null
  }
  return null
}

function booksFromLedger(): string[] {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(USER_DATA, "library.json"), "utf8")) as {
      books?: Array<{ path?: string }>
    }
    const root = (() => {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(USER_DATA, "config.json"), "utf8")) as {
          libraryDir?: string | null
        }
        if (config.libraryDir) return config.libraryDir
      } catch {
        // No config: the default, matching src/main/paths.ts.
      }
      return path.join(os.homedir(), "Documents", "LBook Library")
    })()

    return (ledger.books ?? [])
      .map((book) => book.path ?? "")
      .filter((value) => value !== "")
      .map((value) => (path.isAbsolute(value) ? value : path.resolve(root, value)))
      .filter((dir) => fs.existsSync(path.join(dir, ".lbook", "ocr.json")))
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const take = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined)

  const candidates = booksFromLedger()
    .map((dir) => ({ dir, size: fs.statSync(path.join(dir, ".lbook", "ocr.json")).size }))
    .sort((a, b) => b.size - a.size)

  const wanted = take("--dir") ?? (take("--book") ? candidates.find((c) => c.dir.includes(take("--book") ?? ""))?.dir : candidates[0]?.dir)
  if (!wanted) {
    console.error("no book found. Use --dir <book folder>, or add a book in the app first.")
    process.exitCode = 1
    return
  }

  const ocrPath = path.join(wanted, ".lbook", "ocr.json")
  const metaPath = path.join(wanted, ".lbook", "meta.json")
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { title: string; pageCount: number }
  const original = fs.readFileSync(ocrPath)

  console.log(`${meta.title} — ${(original.length / 1048576).toFixed(1)}MB, ${meta.pageCount} pages\n`)

  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
  fs.mkdirSync(TEMP_ROOT, { recursive: true })

  const { spans } = await scanPageSpans(ocrPath)
  const pageIndex = 20
  const span = spans[pageIndex]
  const element = original.subarray(span.start, span.end)
  const range = valueRangeOf(element, "block_content", 0)
  if (range === null) throw new Error("no block_content found in that page")

  const before = element.subarray(range.start, range.end)
  console.log(
    `page ${pageIndex + 1}: element ${element.length} bytes; its first block_content is bytes ${range.start}..${range.end} of it (${before.length} bytes)`,
  )

  // A realistic correction: longer than the original, so every later offset shifts.
  const replacement = Buffer.from(JSON.stringify("这是修正后的文本，比原来长一些，用来测偏移位移。"))
  const delta = replacement.length - before.length
  const absolute = span.start + range.start

  const staging = path.join(TEMP_ROOT, "ocr.incoming")
  const timings: Record<string, number> = {}

  let t = process.hrtime.bigint()
  fs.copyFileSync(ocrPath, staging)
  timings.copy = ms(t, process.hrtime.bigint())

  const copy = fs.readFileSync(staging)
  t = process.hrtime.bigint()
  const spliced = Buffer.concat([
    copy.subarray(0, absolute),
    replacement,
    copy.subarray(absolute + before.length),
  ])
  timings.splice = ms(t, process.hrtime.bigint())

  t = process.hrtime.bigint()
  fs.writeFileSync(`${staging}.2`, spliced)
  timings.write = ms(t, process.hrtime.bigint())

  t = process.hrtime.bigint()
  fs.renameSync(`${staging}.2`, staging)
  timings.rename = ms(t, process.hrtime.bigint())

  // ---- the claim: only the edited bytes moved ---------------------------------
  const after = fs.readFileSync(staging)
  const prefixSame = after.subarray(0, absolute).equals(original.subarray(0, absolute))
  const suffixSame = after
    .subarray(absolute + replacement.length)
    .equals(original.subarray(absolute + before.length))

  console.log(`\n  copy the file            ${timings.copy.toFixed(1)} ms`)
  console.log(`  splice in memory         ${timings.splice.toFixed(1)} ms`)
  console.log(`  write the spliced file   ${timings.write.toFixed(1)} ms`)
  console.log(`  rename over the original ${timings.rename.toFixed(1)} ms`)
  const total = timings.copy + timings.splice + timings.write + timings.rename
  console.log(`  ─────────────────────────────────────`)
  console.log(`  total                    ${total.toFixed(1)} ms`)

  const verdicts: Array<[string, boolean, string]> = [
    ["prefix byte-identical", prefixSame, ""],
    ["suffix byte-identical", suffixSame, ""],
    ["length grew by the delta", after.length === original.length + delta, `${delta} bytes`],
  ]
  console.log("")
  for (const [what, ok, detail] of verdicts) {
    console.log(`  ${ok ? "✓" : "✗"} ${what.padEnd(26)} ${detail}`)
  }

  // The index does not have to be rebuilt: one contiguous replacement shifts every
  // later span by the same delta.
  t = process.hrtime.bigint()
  const rescanned = await scanPageSpans(staging)
  const rescanMs = ms(t, process.hrtime.bigint())
  console.log(`\n  rescanning instead       ${rescanMs.toFixed(1)} ms (${rescanned.spans.length} pages)`)
  console.log(`  ... or shift the cached spans after page ${pageIndex + 1} by ${delta} bytes: exact, and free`)

  const onlyPdfIsBig = fs.statSync(path.join(wanted, "book.pdf")).size / 1048576
  console.log(
    `\n  (this book's PDF is ${onlyPdfIsBig.toFixed(0)}MB and is never touched by an edit — only ocr.json is written)`,
  )

  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
