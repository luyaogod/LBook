/**
 * 性能探针：把"文件夹式书库"的读路径与现在的路径放在同一张表里量。
 *
 * 为什么要有这个脚本：`PLAN.md` 那次重构押在一个前提上——**单个大 OCR JSON +
 * 字节偏移索引**能顶住阅读性能，而且内存不与文件大小挂钩。前提不能靠感觉。
 *
 *   A 书库扫描    读每本书的 meta.json（每本一个文件，不碰 OCR JSON）
 *   B 冷开书      读 meta.json + 建偏移索引 + 取第 1 页；另给"只扫到第 30 页"的早期退出
 *   C 索引缓存    偏移索引落成 JSON 再读回来，对比"重扫一遍"
 *   D 顺序翻页    往后 40 页，逐页取切片 + JSON.parse
 *   E 随机跳页    随机 30 页
 *   F Flow 连滚   连续 60 页（模拟滚动时的按需取页）
 *   G 内存        三个子进程分别量"空跑 / 懒加载 / 整文件 parse"的 RSS，差值才是设计差异
 *   H 对照        现在这条路：SQLite 取一页 + 块；`.lbook` 区间读（yauzl）对比普通文件区间读
 *
 * 用法：
 *   npm run probe:perf                      # 库里 OCR JSON 最大的那本
 *   npm run probe:perf -- --book 经济法      # 按文件名片段挑一本
 *   npm run probe:perf -- --ocr <某个.json>  # 直接量一个裸的 OCR JSON（不碰 .lbook）
 *   npm run probe:perf -- --padding 200     # 书库扫描时补足到 200 本（模拟大库）
 *   npm run probe:perf -- --keep            # 留下解出来的临时文件夹
 *
 * `--padding` 造的是"只有 meta.json 的空书文件夹"，只量"每本书一个小文件"的读取代价。
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import Database from "better-sqlite3"

import { listEntries, readEntry, readManifest, readPdfRange, pdfSize, closeBook } from "../src/main/lbook/reader"
import { createPageRepo } from "../src/main/db/repositories/pages"
import { createBlockRepo } from "../src/main/db/repositories/blocks"

const USER_DATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "LBook")
const DB_FILE = path.join(USER_DATA, "lbook.db")
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

function readLibraryDir(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(USER_DATA, "config.json"), "utf8")) as {
      libraryDir?: string | null
    }
    if (raw.libraryDir) return raw.libraryDir
  } catch {
    // 没有 config.json 就用默认位置（与 src/main/paths.ts 的默认一致）。
  }
  return path.join(os.homedir(), "Documents", "LBook Library")
}

// ---- 偏移索引 -------------------------------------------------------------

const KEY = Buffer.from('"layoutParsingResults"')
const CHUNK = 1024 * 1024
/** 找 key 的前缀上限：PaddleOCR 的输出里它就在头几行，但真被放在很后面也能顶到这。 */
const MAX_PREFIX = 8 * 1024 * 1024

interface ScanState {
  /** 数组本身的层级：从 1 开始（左括号不计入扫描，直接初始化为 1） */
  depth: number
  inString: boolean
  escaped: boolean
  start: number
}

/**
 * 扫一遍 JSON 字节流，记下 `layoutParsingResults[]` 每个元素的 `[start, end)`。
 *
 * 只跟踪"花括号层级 + 字符串状态"，不解析内容、不假设缩进——用户用编辑器重排过、
 * 换行符被改成 LF/CRLF 都不影响。**流式分块读**，内存里从不需要出现整个文件：状态机
 * 是纯字节的（`{` `}` `[` `]` `"` `\` 都是单字节 ASCII，多字节 UTF-8 只可能出现在字符串
 * 内部，而字符串内部我们只找这两个 ASCII 字节），所以跨块不需要任何残留缓冲。
 *
 * Phase 1 会把它搬进 `src/main/lbook/`，并补上"结构被改坏"的用例。
 */
function scanOffsets(file: string, limit?: number): { spans: Array<[number, number]>; bytes: number; ms: number } {
  const t0 = process.hrtime.bigint()
  const fd = fs.openSync(file, "r")
  const spans: Array<[number, number]> = []
  const state: ScanState = { depth: 1, inString: false, escaped: false, start: -1 }
  const scratch = Buffer.allocUnsafe(CHUNK)
  let bytes = 0

  try {
    const size = fs.fstatSync(fd).size
    bytes = size
    const arrayAt = findArrayStart(fd, size)
    if (arrayAt === null) return { spans: [], bytes, ms: ms(t0, process.hrtime.bigint()) }

    let pos = arrayAt + 1
    while (pos < size) {
      const read = fs.readSync(fd, scratch, 0, CHUNK, pos)
      if (read <= 0) break
      const buf = read === CHUNK ? scratch : scratch.subarray(0, read)
      if (scanBytes(buf, state, spans, pos, limit)) break
      pos += read
    }
  } finally {
    fs.closeSync(fd)
  }

  return { spans, bytes, ms: ms(t0, process.hrtime.bigint()) }
}

/**
 * 找 `layoutParsingResults` 后面那个左括号的绝对偏移。
 *
 * 用"前缀不够就翻倍"的笨办法而不再做跨块 carry：key 实际就在文件头几行，
 * 而带跨块残留的搜索状态机是这一块最容易出错的地方，不值得为它写几百行。
 */
function findArrayStart(fd: number, size: number): number | null {
  let prefix = Math.min(65536, size)
  for (;;) {
    const head = Buffer.allocUnsafe(prefix)
    const read = fs.readSync(fd, head, 0, prefix, 0)
    const view = head.subarray(0, read)
    const keyAt = view.indexOf(KEY)
    if (keyAt >= 0) {
      const at = view.indexOf(0x5b /* [ */, keyAt)
      if (at >= 0) return at
    }
    if (read >= size || prefix >= MAX_PREFIX) return null
    prefix = Math.min(prefix * 8, size, MAX_PREFIX)
  }
}

/**
 * 状态机本体；`base` 是这一块在文件里的绝对偏移。返回 true 表示可以收工了
 * （数组结束，或已经拿到 `limit` 个元素）。
 */
function scanBytes(
  buf: Buffer,
  state: ScanState,
  spans: Array<[number, number]>,
  base: number,
  limit?: number,
): boolean {
  for (let p = 0; p < buf.length; p++) {
    const c = buf[p]
    if (state.inString) {
      if (state.escaped) state.escaped = false
      else if (c === 0x5c /* \ */) state.escaped = true
      else if (c === 0x22 /* " */) state.inString = false
      continue
    }
    if (c === 0x22) {
      state.inString = true
      continue
    }
    if (c === 0x7b || c === 0x5b) {
      state.depth++
      if (state.depth === 2 && state.start < 0) state.start = base + p
      continue
    }
    if (c === 0x7d || c === 0x5d) {
      state.depth--
      if (state.depth === 1 && state.start >= 0) {
        spans.push([state.start, base + p + 1])
        state.start = -1
        if (limit !== undefined && spans.length >= limit) return true
      }
      if (state.depth === 0) return true
    }
  }
  return false
}

/** 按偏移读一段并解析——这是新架构里"取第 N 页"的全部实现。 */
function readSlice(fd: number, start: number, end: number): unknown {
  const length = end - start
  const buf = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, start + read)
    if (n <= 0) throw new Error(`短读：期望 ${length} 字节，只读到 ${read}`)
    read += n
  }
  return JSON.parse(buf.toString("utf8"))
}

// ---- 摊成"文件夹式"的书 ----------------------------------------------------

interface Prepared {
  dir: string
  uid: string | null
  title: string
  pdfFile: string
  ocrFile: string
  lbookFile: string | null
  pageCount: number
  extractMs: number
}

async function prepareBook(lbookFile: string): Promise<Prepared> {
  const manifest = (await readManifest(lbookFile)) as { uid: string; title: string; pageCount: number }
  const dir = path.join(TEMP_ROOT, manifest.uid)
  const pdfFile = path.join(dir, "book.pdf")
  const ocrFile = path.join(dir, "ocr.json")
  const metaFile = path.join(dir, "meta.json")
  const base = {
    dir,
    uid: manifest.uid,
    title: manifest.title,
    pdfFile,
    ocrFile,
    lbookFile,
    pageCount: manifest.pageCount,
    extractMs: 0,
  }

  if (fs.existsSync(metaFile) && fs.existsSync(ocrFile) && fs.existsSync(pdfFile)) return base

  fs.mkdirSync(dir, { recursive: true })
  const t0 = process.hrtime.bigint()

  // PDF 按 8MB 分块从包里读出来落成普通文件——新架构里它就是普通文件。
  // 这段耗时是**一次性迁移成本**，所以单独报出来。
  const size = await pdfSize(lbookFile)
  const out = fs.openSync(pdfFile, "w")
  try {
    const STEP = 8 * 1024 * 1024
    for (let begin = 0; begin < size; begin += STEP) {
      fs.writeSync(out, await readPdfRange(lbookFile, begin, Math.min(begin + STEP, size)))
    }
  } finally {
    fs.closeSync(out)
  }

  // OCR JSON 逐字节原样写出去：新架构不做任何格式改写。
  fs.writeFileSync(ocrFile, await readEntry(lbookFile, "ocr.json"))
  fs.writeFileSync(
    metaFile,
    `${JSON.stringify(
      {
        formatVersion: 1,
        uid: manifest.uid,
        title: manifest.title,
        pageCount: manifest.pageCount,
        ocrFile: "ocr.json",
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  return { ...base, extractMs: ms(t0, process.hrtime.bigint()) }
}

/** 造 N 个只有 meta.json 的书文件夹（与真书同级），量"每本一个小文件"的读取代价。 */
function padLibrary(count: number): void {
  const marker = path.join(TEMP_ROOT, `_padding-${count}.done`)
  if (fs.existsSync(marker)) return
  for (let i = 0; i < count; i++) {
    const dir = path.join(TEMP_ROOT, `padding-book-${i}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ formatVersion: 1, uid: `pad-${i}`, title: `Padding ${i}`, pageCount: 100, ocrFile: "ocr.json" }),
    )
  }
  fs.writeFileSync(marker, "")
}

// ---- 子进程模式（内存要三个进程分别量才可比）--------------------------------

interface ChildResult {
  rss: number
  scanMs?: number
  pageMs?: number
  pages?: number
  /** 仅 --verify 会带 */
  scanned?: number
  ok?: number
  bad?: number
}

function runChild(args: string[]): ChildResult {
  const r = spawnSync(process.execPath, [__filename, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`子进程 ${args[0]} 失败：${r.stderr}`)
  return JSON.parse(r.stdout.trim()) as ChildResult
}

/** 子进程模式的入口；父进程用 `--idle` / `--lazy` / `--baseline` / `--verify` 调自己。 */
const CHILD_MODES = new Set(["--idle", "--lazy", "--baseline", "--verify"])

function childMode(): void {
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
    // 全程不把文件读进内存：流式扫索引，再按偏移读 n 页。
    const { spans, ms: scanMs } = scanOffsets(file)
    const fd = fs.openSync(file, "r")
    const t0 = process.hrtime.bigint()
    try {
      for (let i = 0; i < Math.min(count, spans.length); i++) readSlice(fd, spans[i][0], spans[i][1])
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
    // 最硬的正确性检查：把扫描器给的每一页切片交给 V8 自己 parse，再与
    // "整文件 parse 后的第 n 个元素"逐一深度比对。放在子进程里做，免得
    // 整文件 parse 的内存污染上面那组内存数字。
    const text = fs.readFileSync(file, "utf8")
    const all = JSON.parse(text) as { layoutParsingResults: unknown[] }
    const scanned = scanOffsets(file).spans
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
  throw new Error(`未知子进程模式 ${String(mode)}`)
}

// ---- 主流程 ---------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const keep = argv.includes("--keep")
  const take = (flag: string): string | undefined => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
  const bookFilter = take("--book")
  const ocrArg = take("--ocr")
  const padding = Number(take("--padding") ?? 0)

  fs.mkdirSync(TEMP_ROOT, { recursive: true })
  const libraryDir = readLibraryDir()
  console.log(`库目录   ${libraryDir}`)
  console.log(`库索引   ${DB_FILE}`)
  console.log(`临时区   ${TEMP_ROOT}\n`)

  let book: Prepared
  if (ocrArg) {
    // 裸 JSON 模式：不碰 `.lbook`，但为了跟真书走同一条读路径，也在临时区给它造一个
    // 书文件夹（meta.json 里的 ocrFile 写成绝对路径，不去拷那份大文件）。
    const ocrFile = path.resolve(ocrArg)
    const dir = path.join(TEMP_ROOT, `_raw-${path.basename(ocrFile)}`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      `${JSON.stringify({ formatVersion: 1, uid: null, title: path.basename(ocrFile), pageCount: null, ocrFile }, null, 2)}\n`,
      "utf8",
    )
    book = {
      dir,
      uid: null,
      title: path.basename(ocrFile),
      pdfFile: "",
      ocrFile,
      lbookFile: null,
      pageCount: 0,
      extractMs: 0,
    }
    console.log(`直接量裸 JSON ${ocrFile}`)
  } else {
    // 按 **OCR JSON 的大小**挑书，不是按包大小：190MB 的包大多都是 PDF，
    // 拿它量 JSON 路径等于挑了个小块头。
    const candidates: Array<{ file: string; ocrSize: number }> = []
    for (const name of fs.readdirSync(libraryDir)) {
      if (!name.toLowerCase().endsWith(".lbook")) continue
      if (bookFilter && !name.includes(bookFilter)) continue
      const file = path.join(libraryDir, name)
      const entries = await listEntries(file)
      const ocrSize = entries.find((e) => e.name === "ocr.json")?.uncompressedSize ?? 0
      candidates.push({ file, ocrSize })
    }
    candidates.sort((a, b) => b.ocrSize - a.ocrSize)
    if (candidates.length === 0) {
      console.error("库里没有 .lbook。用 npm run seed:library 造一本，或 --book/--ocr 换目标。")
      process.exit(1)
    }
    console.log("候选（按 ocr.json 大小）:")
    for (const c of candidates.slice(0, 5)) {
      console.log(`  ${mb(c.ocrSize).padStart(8)}  ${path.basename(c.file)}`)
    }
    console.log()
    book = await prepareBook(candidates[0].file)
    if (book.extractMs > 0) {
      console.log(`（首次解包 ${mb(fs.statSync(book.pdfFile).size)} 的 PDF + ocr.json 用时 ${fixed(book.extractMs, 0, 0)} ms —— 一次性迁移成本）`)
    }
  }

  const ocrSize = fs.statSync(book.ocrFile).size
  console.log(`挑中的书 ${book.title}`)
  console.log(`  ocr.json ${mb(ocrSize)}${book.lbookFile ? `   book.pdf ${mb(fs.statSync(book.pdfFile).size)}   .lbook ${mb(fs.statSync(book.lbookFile).size)}` : ""}`)

  // ---- A 书库扫描（只读每本书的 meta.json）----
  if (padding > 0) padLibrary(padding)
  const scanOnce = (): number => {
    const t = process.hrtime.bigint()
    for (const entry of fs.readdirSync(TEMP_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const meta = path.join(TEMP_ROOT, entry.name, "meta.json")
      if (fs.existsSync(meta)) JSON.parse(fs.readFileSync(meta, "utf8"))
    }
    return ms(t, process.hrtime.bigint())
  }
  const scanSamples = Array.from({ length: 5 }, scanOnce)
  const scannedBooks = fs.readdirSync(TEMP_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).length

  // ---- B 冷开书 ----
  const { spans, ms: scanMs } = scanOffsets(book.ocrFile)
  if (spans.length === 0) throw new Error("ocr.json 里找不到 layoutParsingResults")
  const t1 = process.hrtime.bigint()
  const meta = JSON.parse(fs.readFileSync(path.join(book.dir, "meta.json"), "utf8")) as { ocrFile: string }
  const metaMs = ms(t1, process.hrtime.bigint())
  const fd = fs.openSync(book.ocrFile, "r")
  const t2 = process.hrtime.bigint()
  const firstPage = readSlice(fd, spans[0][0], spans[0][1]) as { prunedResult?: { parsing_res_list?: unknown[] } }
  const firstPageMs = ms(t2, process.hrtime.bigint())
  const early = scanOffsets(book.ocrFile, 30)

  // 先证索引是对的，再谈它有多快。
  const verify = runChild(["--verify", book.ocrFile])
  const verifyOk = verify.bad === 0 && verify.ok === verify.pages && verify.scanned === verify.pages

  console.log(`\n[目标路径] 单个大 JSON + 字节偏移索引（${spans.length} 页，meta 指向 ${meta.ocrFile}）`)
  console.log(
    `  自检 扫描器 vs V8       ${verify.scanned === verify.pages ? "页数一致" : `页数不一致（扫到 ${verify.scanned} / 数组 ${verify.pages}）`}，逐页深度比对 ${verify.ok}/${verify.pages} 相等${verify.bad ? `，${verify.bad} 页不等` : ""}`,
  )
  console.log(`  B 读 meta.json           ${fixed(metaMs, 8)} ms`)
  console.log(
    `  B 流式扫全文件建索引     ${fixed(scanMs, 8)} ms   （${(ocrSize / 1048576 / (scanMs / 1000)).toFixed(0)} MB/s，全程不把文件读进内存）`,
  )
  console.log(
    `  B 取第 1 页              ${fixed(firstPageMs, 8)} ms   （切片 ${spans[0][1] - spans[0][0]} 字节，${firstPage.prunedResult?.parsing_res_list?.length ?? 0} 块）`,
  )
  console.log(`  B 冷开书合计（全扫版）   ${fixed(metaMs + scanMs + firstPageMs, 8)} ms`)
  console.log(
    `  B 首屏（只扫到第 30 页） ${fixed(metaMs + early.ms + firstPageMs, 8)} ms   （扫那 30 页 ${fixed(early.ms, 0, 2)} ms）`,
  )

  // ---- C 索引缓存 ----
  const indexPath = path.join(TEMP_ROOT, "offsets.json")
  fs.writeFileSync(indexPath, JSON.stringify(spans))
  const cacheSamples = Array.from({ length: 5 }, () => {
    const a = process.hrtime.bigint()
    JSON.parse(fs.readFileSync(indexPath, "utf8"))
    return ms(a, process.hrtime.bigint())
  })
  console.log(
    `  C 读回索引缓存           ${fixed(stats(cacheSamples).mean, 8)} ms   （重扫一次是 ${fixed(scanMs, 0, 2)} ms）`,
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
  console.log(line("D 顺序翻页（取一页）", stats(seq)))
  console.log(line("E 随机跳页（取一页）", stats(rnd)))
  console.log(line("F Flow 连滚 60 页", stats(flow)))
  const flowTotal = flow.reduce((a, b) => a + b, 0)
  console.log(`  ${" ".repeat(26)} 60 页合计 ${fixed(flowTotal)} ms = ${((60 / flowTotal) * 1000).toFixed(0)} 页/秒（仅 JSON 侧）`)

  // ---- G 内存：三个子进程，差值才是设计差异 ----
  const idle = runChild(["--idle"])
  const lazy = runChild(["--lazy", book.ocrFile, String(seq.length + rnd.length + flow.length)])
  const full = runChild(["--baseline", book.ocrFile])
  console.log(`\n[内存] 文件 ${mb(ocrSize)}，三个子进程各量一次（RSS，减掉空跑基线才是设计差异）`)
  console.log(`  G 空跑基线               ${mb(idle.rss)}`)
  console.log(
    `  G 懒加载（索引 + 读了 ${seq.length + rnd.length + flow.length} 页）  ${mb(lazy.rss)}   增量 ${mb(lazy.rss - idle.rss)}   （扫索引 ${fixed(lazy.scanMs ?? 0, 0, 1)} ms）`,
  )
  console.log(`  G 整文件 JSON.parse      ${mb(full.rss)}   增量 ${mb(full.rss - idle.rss)}`)

  // ---- H 对照：现在的路径 ----
  let pdfCompare: Array<[string, number, number]> = []
  if (book.lbookFile && book.uid) {
    console.log(`\n[对照] 现在这条路`)
    const db = new Database(DB_FILE, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare(`SELECT id FROM pdf_documents WHERE uid = ?`).get(book.uid) as { id: number } | undefined
      if (!row) {
        console.log("  索引里没有这本书，跳过 SQLite 对照")
      } else {
        const pages = createPageRepo(db)
        const blocks = createBlockRepo(db)
        const pageIds: number[] = []
        const timedDbPage = (n: number): number => {
          const a = process.hrtime.bigint()
          const p = pages.getByPageNum(row.id, n)
          if (p) {
            pageIds.push(p.id)
            if (p.pruned_result) JSON.parse(p.pruned_result)
          }
          return ms(a, process.hrtime.bigint())
        }
        const dbSeq = Array.from({ length: Math.min(40, spans.length - 1) }, (_, i) => timedDbPage(i + 1))
        const dbRnd = rndPages.map(timedDbPage)
        const probePageId = pageIds[pageIds.length - 1] ?? 0
        const blockRows = blocks.listRowsByPage(probePageId)
        const dbBlocks = Array.from({ length: 20 }, () => {
          const a = process.hrtime.bigint()
          for (const b of blocks.listRowsByPage(probePageId)) JSON.parse(b.block_bbox)
          return ms(a, process.hrtime.bigint())
        })
        const briefs = pages.listBriefs(row.id)
        const dbBriefs = Array.from({ length: 5 }, () => {
          const a = process.hrtime.bigint()
          pages.listBriefs(row.id)
          return ms(a, process.hrtime.bigint())
        })
        console.log(line("H SQLite 顺序取一页", stats(dbSeq)))
        console.log(line("H SQLite 随机取一页", stats(dbRnd)))
        console.log(line(`H SQLite 取一页的块+bbox`, stats(dbBlocks)) + `（${blockRows.length} 行）`)
        console.log(line(`H SQLite listBriefs(${briefs.length} 页)`, stats(dbBriefs)))
        console.log(`  ${"".padEnd(26)} 目标路径：顺序 ${fixed(stats(seq).mean)} ms、随机 ${fixed(stats(rnd).mean)} ms`)
      }
    } finally {
      db.close()
    }

    const pdfBytes = fs.statSync(book.pdfFile).size
    pdfCompare = [
      ["前 64KB", 0, 65536],
      ["中间 2MB", Math.floor(pdfBytes / 2), 2 * 1024 * 1024],
    ]
    for (const [label, begin, length] of pdfCompare) {
      const zipSamples: number[] = []
      for (let i = 0; i < 5; i++) {
        const a = process.hrtime.bigint()
        await readPdfRange(book.lbookFile, begin, begin + length)
        zipSamples.push(ms(a, process.hrtime.bigint()))
      }
      const pdfFd = fs.openSync(book.pdfFile, "r")
      const fileSamples: number[] = []
      const scratch = Buffer.allocUnsafe(length)
      try {
        for (let i = 0; i < 5; i++) {
          const a = process.hrtime.bigint()
          fs.readSync(pdfFd, scratch, 0, length, begin)
          fileSamples.push(ms(a, process.hrtime.bigint()))
        }
      } finally {
        fs.closeSync(pdfFd)
      }
      const z = stats(zipSamples)
      const s = stats(fileSamples)
      console.log(
        `  H PDF ${label.padEnd(9)} .lbook(zip) ${fixed(z.mean, 6)} ms   普通文件 ${fixed(s.mean, 6)} ms   （快 ${(z.mean / s.mean).toFixed(1)}×）`,
      )
    }

    await closeBook(book.lbookFile)
  }

  fs.closeSync(fd)

  // ---- 判定（阈值就是 PLAN.md Phase 0 的验收线）----
  const coldOpen = metaMs + scanMs + firstPageMs
  const earlyOpen = metaMs + early.ms + firstPageMs
  const lazyDelta = lazy.rss - idle.rss
  const fullDelta = full.rss - idle.rss
  const checks: Array<[string, boolean, string]> = [
    ["索引自检 100% 一致", verifyOk, `${verify.ok}/${verify.pages} 页深度相等`],
    ["冷开书 < 150ms", coldOpen < 150, `${fixed(coldOpen, 0, 1)} ms`],
    ["首屏 < 50ms", earlyOpen < 50, `${fixed(earlyOpen, 0, 1)} ms`],
    ["顺序翻页 p95 < 5ms", stats(seq).p95 < 5, `${fixed(stats(seq).p95)} ms`],
    ["随机跳页 p95 < 5ms", stats(rnd).p95 < 5, `${fixed(stats(rnd).p95)} ms`],
    ["扫描每本 < 5ms", stats(scanSamples).mean / scannedBooks < 5, `${fixed((stats(scanSamples).mean / scannedBooks) * 1000, 0, 0)} µs/本`],
    [
      "懒加载增量 < 文件大小",
      lazyDelta < ocrSize,
      `${mb(lazyDelta)} vs 文件 ${mb(ocrSize)}（整文件 parse 增量 ${mb(fullDelta)}）`,
    ],
  ]
  console.log(`\n[判定]`)
  for (const [what, ok, detail] of checks) console.log(`  ${ok ? "✓" : "✗"} ${what.padEnd(24)} ${detail}`)

  if (keep) {
    console.log(`\n（临时区保留在 ${TEMP_ROOT}）`)
  } else {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
    console.log(`\n（临时区已清理；加 --keep 可保留）`)
  }
}

if (CHILD_MODES.has(process.argv[2] ?? "")) childMode()
else
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
