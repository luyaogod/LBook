/**
 * Ad-hoc verification of the Phase 2 inspector against real data.
 *
 * Takes a real book's OCR file and breaks it two ways — a missing comma
 * *between* two pages (which only a whole-file parse can see) and a missing brace
 * *inside* one page (which the per-page reader catches) — then checks that the
 * inspector reports both with a byte offset, never throws, and that page 1 still
 * reads. Not part of the test suite: it needs a real migrated book on disk.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { inspectBook } from "../src/main/library/inspect"
import { openBook } from "../src/main/library/book"
import { scanPageSpans } from "../src/main/lbook/offsetIndex"

/**
 * Which book to break, as a copy in the temp directory.
 *
 *   npm run check:inspect -- <book folder>
 *
 * Nothing in the real library is written: the folder is copied, and only the copy is
 * damaged.
 */
const SOURCE = path.resolve(process.argv[2] ?? ".")

if (!fs.existsSync(path.join(SOURCE, ".lbook", "meta.json"))) {
  console.error("usage: npm run check:inspect -- <book folder>")
  console.error("(it copies the folder to a temp directory first; your files are not touched)")
  process.exit(1)
}
const work = path.join(os.tmpdir(), "lbook-check-book")

async function main(): Promise<void> {
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })

  const dataDir = path.join(SOURCE, ".lbook")
  const meta = fs.readFileSync(path.join(dataDir, "meta.json"), "utf8")
  const ocrName = (JSON.parse(meta) as { ocrFile?: string }).ocrFile ?? "ocr.json"
  const ocr = fs.readFileSync(path.join(dataDir, ocrName))
  fs.writeFileSync(path.join(work, "book.pdf"), "%PDF-1.7\n")
  fs.mkdirSync(path.join(work, ".lbook"), { recursive: true })
  fs.writeFileSync(path.join(work, ".lbook", "meta.json"), meta)

  const spans = (await scanPageSpans(path.join(dataDir, ocrName))).spans
  const page300 = spans[299]
  const page301 = spans[300]
  console.log(`real file: ${spans.length} pages\n`)

  // ---- case 1: a missing comma *between* two pages ------------------------
  const commaAt = page300.end
  writeBroken(removeByte(ocr, commaAt))
  console.log(
    `case 1: removed the ${JSON.stringify(String.fromCharCode(ocr[commaAt]))} at byte ${commaAt} (between pages)`,
  )
  const between = await inspectBook(work, { deep: true })
  report(between)
  const caught = between.find((issue) => issue.message.includes("as a whole"))
  console.log(
    `${caught && caught.offset !== undefined ? "PASS" : "FAIL"} a whole-file finding carries a byte offset` +
      `${caught?.offset !== undefined ? ` (${caught.offset})` : ""}\n`,
  )

  // ---- case 2: a missing brace *inside* one page --------------------------
  const braceAt = page301.end - 1
  writeBroken(removeByte(ocr, braceAt))
  console.log(
    `case 2: removed the ${JSON.stringify(String.fromCharCode(ocr[braceAt]))} at byte ${braceAt} (inside page 301)`,
  )
  const inside = await inspectBook(work, { deep: true })
  report(inside)
  const pageFinding = inside.find((issue) => issue.jsonPath === "layoutParsingResults[300]")
  console.log(
    `${pageFinding && pageFinding.offset !== undefined ? "PASS" : "FAIL"} the broken page is named with its offset` +
      `${pageFinding ? ` (${pageFinding.jsonPath} @ ${pageFinding.offset})` : ""}\n`,
  )

  // ---- page 1 still reads, damage or not ---------------------------------
  writeBroken(removeByte(ocr, braceAt))
  const book = await openBook(work)
  const pageCount = await book.pageCount()
  const page1 = (await book.readPage(1)) as { prunedResult?: { parsing_res_list?: unknown[] } }
  const blocks = page1.prunedResult?.parsing_res_list?.length ?? 0
  console.log(`PASS the book still opens: ${pageCount} pages visible, page 1 has ${blocks} blocks`)

  fs.rmSync(work, { recursive: true, force: true })
}

function removeByte(buffer: Buffer, at: number): Buffer {
  return Buffer.concat([buffer.subarray(0, at), buffer.subarray(at + 1)])
}

function writeBroken(data: Buffer): void {
  fs.writeFileSync(path.join(work, ".lbook", "ocr.json"), data)
}

function report(issues: Awaited<ReturnType<typeof inspectBook>>): void {
  console.log(`  ${issues.length} issue(s):`)
  for (const issue of issues.slice(0, 4)) {
    console.log(
      `    [${issue.level}] ${issue.message}` +
        `${issue.offset !== undefined ? ` @ ${issue.offset}` : ""}` +
        `${issue.jsonPath ? ` (${issue.jsonPath})` : ""}`,
    )
  }
  if (issues.length > 4) console.log(`    … and ${issues.length - 4} more`)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
