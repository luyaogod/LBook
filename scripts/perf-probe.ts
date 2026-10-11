/**
 * Performance probe: measures the folder-based read path a reader actually uses.
 *
 * Why this exists: the refactor in `PLAN.md` rests on one premise — that **one
 * large OCR JSON plus a byte-offset index** holds up under reading, and that its
 * memory does not scale with the file. A premise like that cannot be assumed.
 *
 *   A library scan   read every book's meta.json (one small file per book)
 *   B cold open      meta.json + build the offset index + read page 1, plus an
 *                    early exit that only scans the first 30 pages
 *   C index cache    write the index out as JSON and read it back, against
 *                    rescanning
 *   D sequential     the next 40 pages, one slice + JSON.parse each
 *   E random jumps   30 random pages
 *   F flow scroll    60 pages in a row (what scrolling asks for)
 *   G memory         three subprocesses measuring idle / lazy / whole-file parse
 *                    RSS; the difference between them is the design difference
 *
 * Usage:
 *   npm run probe:perf                       # the book with the largest ocr.json
 *   npm run probe:perf -- --book 经济法       # pick a book by folder-name fragment
 *   npm run probe:perf -- --dir <folder>     # measure one book folder
 *   npm run probe:perf -- --ocr <file.json>  # measure a bare OCR JSON
 *   npm run probe:perf -- --padding 200      # pad the scan with 200 empty books
 *   npm run probe:perf -- --keep             # keep the temp area
 *
 * `--padding` creates folders that hold nothing but a `meta.json`, because that
 * is all a library scan reads.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { readSpanAt, scanPageSpans } from "../src/main/lbook/offsetIndex"

const USER_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "LBook")
const TEMP_ROOT = path.join(os.tmpdir(), "lbook-perf")

const ms = (a: bigint, b: bigint) => Number(b - a) / 1e6
const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`
const fixed = (n: number, width = 7, digits = 2) => n.toFixed(digits).padStart(width)

interface Stats {
  n: number
  mean: number
  p50: number
  p95: number
  max: number
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
  }
}

const line = (label: string, s: Stats) =>
  `  ${label.padEnd(26)} n=${String(s.n).padStart(3)}  mean ${fixed(s.mean)}  p50 ${fixed(s.p50)}  p95 ${fixed(s.p95)}  max ${fixed(s.max)} ms`

/** The default new-book location, from config.json when it has one. */
function readLibraryRoot(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(USER_DATA, "config.json"), "utf8")) as {
      libraryDir?: string | null
    }
    if (raw.libraryDir) return raw.libraryDir
  } catch {
    // No config.json: use the default, matching src/main/paths.ts.
  }
  return path.join(os.homedir(), "Documents", "LBook Library")
}

/**
 * Every book folder the app knows about, from the ledger.
 *
 * Reading the ledger (rather than scanning a directory) is the point of A11: the
 * books may live anywhere, and the list is the app's own file.
 */
function booksFromLedger(): string[] {
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(USER_DATA, "library.json"), "utf8")) as {
      books?: Array<{ path?: string }>
    }
    const root = readLibraryRoot()
    return (ledger.books ?? [])
      .map((book) => book.path ?? "")
      .filter((bookPath) => bookPath !== "")
      .map((bookPath) => (path.isAbsolute(bookPath) ? bookPath : path.resolve(root, bookPath)))
      .filter((dir) => fs.existsSync(path.join(dir, ".lbook", "meta.json")))
  } catch {
    return []
  }
}

// ---- offset index ---------------------------------------------------------

/**
 * Reads the file once and reports every page's byte range (with how many bytes
 * were actually read, which is what "first screen" is measured on).
 *
 * The implementation lives in `src/main/lbook/offsetIndex.ts` — Phase 1 moved it
 * out of this probe and gave it unit tests. **The probe must measure the code that
 * ships**, so this only wraps it in a timer.
 */
async function scanOffsets(
  file: string,
  limit?: number,
): Promise<{ spans: Array<[number, number]>; bytes: number; ms: number; scanned: number }> {
  const t0 = process.hrtime.bigint()
  const { spans, fileBytes, scannedBytes } = await scanPageSpans(file, { limit })
  return {
    spans: spans.map((s): [number, number] => [s.start, s.end]),
    bytes: fileBytes,
    scanned: scannedBytes,
    ms: ms(t0, process.hrtime.bigint()),
  }
}

/** Reads one page by offset — again through the shipping implementation. */
function readSlice(fd: number, start: number, end: number): unknown {
  return readSpanAt(fd, { start, end })
}

// ---- book folders ---------------------------------------------------------

interface Prepared {
  dir: string
  uid: string | null
  title: string
  pdfFile: string
  ocrFile: string
  /** Set only when the temp area had to be used (a bare JSON). */
  synthetic: boolean
}

function preparedFromDir(dir: string): Prepared {
  const meta = JSON.parse(
    fs.readFileSync(path.join(dir, ".lbook", "meta.json"), "utf8"),
  ) as {
    uid?: string
    title?: string
    ocrFile: string
  }
  return {
    dir,
    uid: meta.uid ?? null,
    title: meta.title ?? path.basename(dir),
    pdfFile: path.join(dir, "book.pdf"),
    ocrFile: path.join(dir, ".lbook", meta.ocrFile),
    synthetic: false,
  }
}

/** A bare OCR JSON, wrapped in a minimal book folder inside the temp area. */
function preparedFromOcr(ocrArg: string): Prepared {
  const ocrFile = path.resolve(ocrArg)
  const dir = path.join(TEMP_ROOT, "_raw")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    `${JSON.stringify(
      {
        formatVersion: 1,
        uid: "raw",
        title: path.basename(ocrFile),
        pageCount: 0,
        ocrFile,
        source: "perf-probe",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return { dir, uid: null, title: path.basename(ocrFile), pdfFile: "", ocrFile, synthetic: true }
}

/** Creates N book folders that hold only a `.lbook/meta.json`, to price a library scan. */
function padLibrary(count: number): number {
  for (let i = 0; i < count; i++) {
    const dir = path.join(TEMP_ROOT, `padding-book-${i}`, ".lbook")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        formatVersion: 1,
        uid: `pad-${i}`,
        title: `Padding ${i}`,
        pageCount: 100,
        ocrFile: "ocr.json",
      }),
    )
  }
  return count
}

// ---- subprocess modes (memory has to be measured in separate processes) ----

interface ChildResult {
  rss: number
  scanMs?: number
  pageMs?: number
  pages?: number
  /** Only --verify reports these. */
  scanned?: number
  ok?: number
  bad?: number
}

function runChild(args: string[]): ChildResult {
  const r = spawnSync(process.execPath, [__filename, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`child ${args[0]} failed: ${r.stderr}`)
  return JSON.parse(r.stdout.trim()) as ChildResult
}

/** Entry point for the child modes the parent invokes on this same file. */
const CHILD_MODES = new Set(["--idle", "--lazy", "--baseline", "--verify"])

async function childMode(): Promise<void> {
  const mode = process.argv[2]
  if (mode === "--idle") {
    process.stdout.write(JSON.stringify({ rss: process.memoryUsage().rss }))
    return
  }
  const file = process.argv[3]
  if (mode === "--baseline") {
    const text = fs.readFileSync(file, "utf8")
    const parsed = JSON.parse(text) as { layoutParsingResults: unknown[] }
    process.stdout.write(
      JSON.stringify({ rss: process.memoryUsage().rss, pages: parsed.layoutParsingResults.length }),
    )
    return
  }
  if (mode === "--lazy") {
    const count = Number(process.argv[4] ?? 130)
    // The file never enters memory as a whole: stream the index, then read pages
    // by offset.
    const { spans, ms: scanMs } = await scanOffsets(file)
    const fd = fs.openSync(file, "r")
    const t0 = process.hrtime.bigint()
    try {
      for (let i = 0; i < Math.min(count, spans.length); i++) {
        readSlice(fd, spans[i][0], spans[i][1])
      }
    } finally {
      fs.closeSync(fd)
    }
    process.stdout.write(
      JSON.stringify({
        rss: process.memoryUsage().rss,
        scanMs,
        pageMs: ms(t0, process.hrtime.bigint()),
        pages: spans.length,
      }),
    )
    return
  }
  if (mode === "--verify") {
    // The hardest correctness check there is: hand every slice the scanner
    // produced to V8 and deep-compare it with "element n of the whole-file parse".
    // Done in a child so the whole-file parse cannot pollute the memory numbers.
    const text = fs.readFileSync(file, "utf8")
    const all = JSON.parse(text) as { layoutParsingResults: unknown[] }
    const scanned = (await scanOffsets(file)).spans
    const fd = fs.openSync(file, "r")
    let ok = 0
    let bad = 0
    try {
      for (let n = 0; n < Math.min(scanned.length, all.layoutParsingResults.length); n++) {
        const mine = JSON.stringify(readSlice(fd, scanned[n][0], scanned[n][1]))
        const theirs = JSON.stringify(all.layoutParsingResults[n])
        if (mine === theirs) ok++
        else bad++
      }
    } finally {
      fs.closeSync(fd)
    }
    process.stdout.write(
      JSON.stringify({
        rss: process.memoryUsage().rss,
        pages: all.layoutParsingResults.length,
        scanned: scanned.length,
        ok,
        bad,
      }),
    )
    return
  }
  throw new Error(`unknown child mode ${String(mode)}`)
}

// ---- main -----------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const keep = argv.includes("--keep")
  const take = (flag: string): string | undefined =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined
  const bookFilter = take("--book")
  const ocrArg = take("--ocr")
  const dirArg = take("--dir")
  const padding = Number(take("--padding") ?? 0)

  fs.mkdirSync(TEMP_ROOT, { recursive: true })
  const libraryRoot = readLibraryRoot()
  console.log(`library root ${libraryRoot}`)
  console.log(`ledger       ${path.join(USER_DATA, "library.json")}`)
  console.log(`temp area    ${TEMP_ROOT}\n`)

  let book: Prepared
  let realBooks: string[] = []
  if (dirArg) {
    book = preparedFromDir(path.resolve(dirArg))
    console.log(`measuring book folder ${book.dir}`)
  } else if (ocrArg) {
    book = preparedFromOcr(ocrArg)
    console.log(`measuring a bare OCR JSON ${book.ocrFile}`)
  } else {
    realBooks = booksFromLedger()
    if (bookFilter) realBooks = realBooks.filter((dir) => dir.includes(bookFilter))
    if (realBooks.length === 0) {
      console.error(
        "no book folders found. Use --dir/--ocr, or add a book in the app first.",
      )
      process.exit(1)
    }

    // Pick by **OCR JSON size**, not by folder size: a 190MB book is mostly PDF,
    // and picking it to measure the JSON path would measure the wrong thing.
    const candidates = realBooks
      .map((dir) => {
        const meta = JSON.parse(
          fs.readFileSync(path.join(dir, ".lbook", "meta.json"), "utf8"),
        ) as {
          ocrFile: string
        }
        const ocrPath = path.join(dir, meta.ocrFile)
        return { dir, ocrPath, size: fs.existsSync(ocrPath) ? fs.statSync(ocrPath).size : 0 }
      })
      .sort((a, b) => b.size - a.size)

    console.log("candidates (by ocr.json size):")
    for (const candidate of candidates.slice(0, 5)) {
      console.log(`  ${mb(candidate.size).padStart(8)}  ${path.basename(candidate.dir)}`)
    }
    console.log()
    book = preparedFromDir(candidates[0].dir)
  }

  const ocrSize = fs.statSync(book.ocrFile).size
  console.log(`book        ${book.title}`)
  console.log(
    `  ocr.json ${mb(ocrSize)}${book.pdfFile && fs.existsSync(book.pdfFile) ? `   book.pdf ${mb(fs.statSync(book.pdfFile).size)}` : ""}`,
  )

  // ---- A library scan (one meta.json per book) ----
  const paddingMade = padding > 0 ? padLibrary(padding) : 0
  const libraryDirs = book.synthetic
    ? fs
        .readdirSync(TEMP_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(TEMP_ROOT, e.name))
    : [...realBooks, ...Array.from({ length: paddingMade }, (_, i) => path.join(TEMP_ROOT, `padding-book-${i}`))]

  const scanOnce = (): number => {
    const t = process.hrtime.bigint()
    for (const dir of libraryDirs) {
      const meta = path.join(dir, ".lbook", "meta.json")
      if (fs.existsSync(meta)) JSON.parse(fs.readFileSync(meta, "utf8"))
    }
    return ms(t, process.hrtime.bigint())
  }
  const scanSamples = Array.from({ length: 5 }, scanOnce)

  // ---- B cold open ----
  const { spans, ms: scanMs } = await scanOffsets(book.ocrFile)
  if (spans.length === 0) throw new Error("no layoutParsingResults in the OCR JSON")
  const t1 = process.hrtime.bigint()
  const meta = JSON.parse(fs.readFileSync(path.join(book.dir, ".lbook", "meta.json"), "utf8")) as {
    ocrFile: string
  }
  const metaMs = ms(t1, process.hrtime.bigint())
  const fd = fs.openSync(book.ocrFile, "r")
  const t2 = process.hrtime.bigint()
  const firstPage = readSlice(fd, spans[0][0], spans[0][1]) as {
    prunedResult?: { parsing_res_list?: unknown[] }
  }
  const firstPageMs = ms(t2, process.hrtime.bigint())
  const early = await scanOffsets(book.ocrFile, 30)

  // Prove the index is right before talking about how fast it is.
  const verify = runChild(["--verify", book.ocrFile])
  const verifyOk = verify.bad === 0 && verify.ok === verify.pages && verify.scanned === verify.pages

  console.log(`\n[target path] one large JSON + byte-offset index (${spans.length} pages, meta says ${meta.ocrFile})`)
  console.log(
    `  self-check scanner vs V8  ${verify.scanned === verify.pages ? "same page count" : `page count differs (scanned ${verify.scanned} / array ${verify.pages})`}, deep-compare ${verify.ok}/${verify.pages} equal${verify.bad ? `, ${verify.bad} differ` : ""}`,
  )
  console.log(`  B read meta.json          ${fixed(metaMs, 8)} ms`)
  console.log(
    `  B stream-scan the file    ${fixed(scanMs, 8)} ms   (${(ocrSize / 1048576 / (scanMs / 1000)).toFixed(0)} MB/s, never whole in memory)`,
  )
  console.log(
    `  B read page 1             ${fixed(firstPageMs, 8)} ms   (slice ${spans[0][1] - spans[0][0]} bytes, ${firstPage.prunedResult?.parsing_res_list?.length ?? 0} blocks)`,
  )
  console.log(`  B cold open (full scan)   ${fixed(metaMs + scanMs + firstPageMs, 8)} ms`)
  console.log(
    `  B first screen (30 pages) ${fixed(metaMs + early.ms + firstPageMs, 8)} ms   (those 30 pages: ${fixed(early.ms, 0, 2)} ms)`,
  )

  // ---- C index cache ----
  const indexPath = path.join(TEMP_ROOT, "offsets.json")
  fs.writeFileSync(indexPath, JSON.stringify(spans))
  const cacheSamples = Array.from({ length: 5 }, () => {
    const a = process.hrtime.bigint()
    JSON.parse(fs.readFileSync(indexPath, "utf8"))
    return ms(a, process.hrtime.bigint())
  })
  console.log(
    `  C read back cached index  ${fixed(stats(cacheSamples).mean, 8)} ms   (rescanning is ${fixed(scanMs, 0, 2)} ms)`,
  )

  // ---- D / E / F ----
  const timedPageRead = (n: number): number => {
    const a = process.hrtime.bigint()
    readSlice(fd, spans[n][0], spans[n][1])
    return ms(a, process.hrtime.bigint())
  }
  const seq = Array.from({ length: Math.min(40, spans.length - 1) }, (_, i) => timedPageRead(i + 1))
  const rndPages = Array.from({ length: 30 }, () => Math.floor(Math.random() * spans.length))
  const rnd = rndPages.map(timedPageRead)
  const flow = Array.from({ length: Math.min(60, spans.length) }, (_, i) => timedPageRead(i))
  console.log(line("D sequential (one page)", stats(seq)))
  console.log(line("E random jumps (one page)", stats(rnd)))
  console.log(line("F flow scroll, 60 pages", stats(flow)))
  const flowTotal = flow.reduce((a, b) => a + b, 0)
  console.log(
    `  ${" ".repeat(26)} 60 pages totalling ${fixed(flowTotal)} ms = ${((60 / flowTotal) * 1000).toFixed(0)} pages/s (JSON side only)`,
  )

  // ---- G memory: three processes, the difference is the design difference ----
  const idle = runChild(["--idle"])
  const lazy = runChild(["--lazy", book.ocrFile, String(seq.length + rnd.length + flow.length)])
  const full = runChild(["--baseline", book.ocrFile])
  console.log(`\n[memory] file ${mb(ocrSize)}, one subprocess each (RSS; subtract the idle baseline)`)
  console.log(`  G idle baseline           ${mb(idle.rss)}`)
  console.log(
    `  G lazy (index + ${seq.length + rnd.length + flow.length} pages)  ${mb(lazy.rss)}   delta ${mb(lazy.rss - idle.rss)}   (index scan ${fixed(lazy.scanMs ?? 0, 0, 1)} ms)`,
  )
  console.log(`  G whole-file JSON.parse   ${mb(full.rss)}   delta ${mb(full.rss - idle.rss)}`)

  fs.closeSync(fd)

  // ---- verdict (the thresholds are PLAN.md Phase 0's acceptance line) ----
  const coldOpen = metaMs + scanMs + firstPageMs
  const earlyOpen = metaMs + early.ms + firstPageMs
  const lazyDelta = lazy.rss - idle.rss
  const fullDelta = full.rss - idle.rss
  const perBookUs = (stats(scanSamples).mean / Math.max(1, libraryDirs.length)) * 1000
  const checks: Array<[string, boolean, string]> = [
    ["index self-check 100%", verifyOk, `${verify.ok}/${verify.pages} pages deep-equal`],
    ["cold open < 150ms", coldOpen < 150, `${fixed(coldOpen, 0, 1)} ms`],
    ["first screen < 50ms", earlyOpen < 50, `${fixed(earlyOpen, 0, 1)} ms`],
    ["sequential p95 < 5ms", stats(seq).p95 < 5, `${fixed(stats(seq).p95)} ms`],
    ["random jump p95 < 5ms", stats(rnd).p95 < 5, `${fixed(stats(rnd).p95)} ms`],
    [
      "library scan < 5ms/book",
      perBookUs < 5000,
      `${perBookUs.toFixed(0)} µs/book over ${libraryDirs.length} books`,
    ],
    [
      "lazy delta < file size",
      lazyDelta < ocrSize,
      `${mb(lazyDelta)} vs ${mb(ocrSize)} file (whole-file parse delta ${mb(fullDelta)})`,
    ],
  ]
  console.log(`\n[verdict]`)
  for (const [what, ok, detail] of checks) console.log(`  ${ok ? "✓" : "✗"} ${what.padEnd(24)} ${detail}`)

  if (keep) {
    console.log(`\n(temp area kept at ${TEMP_ROOT})`)
  } else {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    console.log(`\n(temp area cleaned; pass --keep to keep it)`)
  }
}

if (CHILD_MODES.has(process.argv[2] ?? "")) {
  void childMode().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
