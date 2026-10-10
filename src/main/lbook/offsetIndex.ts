import fs from "node:fs"

/**
 * 把一个大 OCR JSON 当"按页随机访问"的文件来读。
 *
 * 为什么需要它：一本书的 OCR 输出是**一个 8–40MB 的 JSON 文件**（PaddleOCR 原样保存），
 * 而应用要的往往只是"第 N 页"。整文件 `JSON.parse` 在 15.6MB 上要 36ms 并让常驻内存
 * 涨 46MB，而且随文件线性增长；按偏移读一页只要 0.1–0.3ms，**内存与文件大小无关**。
 * 完整实测与取舍见 `PLAN.md` 第 4.2 节，数据存档在 `.agents/plan/baseline.md`。
 *
 * 这个模块里定死了三件事：
 *
 * 1. **流式分块**：内存里永远不出现整个文件。状态机是纯字节的——`{ } [ ] " \` 都是单字节
 *    ASCII，多字节 UTF-8 只可能出现在字符串内部，而字符串内部只找 `"` 与 `\`——所以
 *    **跨块不需要任何残留缓冲**。
 * 2. **不假设格式**：只跟踪花括号层级与字符串状态。用户用编辑器重排过、换行被改成
 *    LF/CRLF、整份被格式化过，都不影响（唯一要做的就是重新扫一遍）。
 * 3. **页号 = `layoutParsingResults` 的数组下标**：PaddleOCR 的元素里没有页号字段。
 *    删掉或插入一个元素会让后面整体错位，所以上层必须拿"页数 = meta.pageCount =
 *    PDF 页数"去兜底校验。
 */

const DEFAULT_CHUNK_BYTES = 1024 * 1024

/**
 * 找数组左括号时前缀的上限。
 *
 * 正常输出里 key 就在头几行，这里只是兜底：前缀按 8 倍递增，最多读到这么多。
 * 比"带跨块残留的搜索状态机"简单得多，而那条路径是这一块最容易出错的地方。
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
  /** 排他：`[start, end)` 正好是这一页元素的字节区间。 */
  readonly end: number
}

export interface ScanResult {
  spans: PageSpan[]
  /** 文件总字节数。 */
  fileBytes: number
  /**
   * 实际读了多少字节。带 `limit` 时它远小于 `fileBytes`——这正是"首屏只付几毫秒"
   * 的来源，也是 `TEST.md` 里那条"渐进式"的量化依据。
   */
  scannedBytes: number
}

export interface ScanOptions {
  /** 只找前 N 页（首屏只需要第一屏那些页）。 */
  limit?: number
  /** 分块大小。测试会把它调得很小，好用少量样本精确打到块边界上。 */
  chunkBytes?: number
}

interface ScanState {
  /** 数组本身的层级：左括号不计入扫描，所以从 1 开始。 */
  depth: number
  inString: boolean
  escaped: boolean
  /** 当前元素在文件里的绝对起始偏移；-1 表示不在元素里。 */
  start: number
}

/**
 * 扫描整个文件，给出每一页的字节区间。
 *
 * 文件里找不到 `layoutParsingResults`、或它是个空数组时返回空数组——**不抛异常**：
 * 这是用户手改过的文件，坏文件要在书库里被"报出来"，而不是让整个书库崩掉。
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

    // 前缀里已经读进来的那一段就地扫掉，不再从磁盘重读一遍：一来账目准确
    // （`scannedBytes` 就是真实读入量），二来首屏少一次 IO。
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
 * 读出某个区间并解析。
 *
 * 用调用方持有的 `fd`（`openBook` 返回的句柄），这样连页读不会反复开文件。
 * `span` 必须来自本模块扫出来的结果——它保证是完整的元素，所以能独立 `JSON.parse`。
 */
export function readSpanAt(fd: number, span: PageSpan): unknown {
  const length = span.end - span.start
  const buf = Buffer.allocUnsafe(length)
  let read = 0
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, span.start + read)
    if (n <= 0) throw new Error(`短读：期望 ${length} 字节，只读到 ${read}`)
    read += n
  }
  return JSON.parse(buf.toString("utf8"))
}

/** 便利版：自己开、自己关。单次读一页时用它就够（开文件的代价小于一次 JSON.parse）。 */
export function readSpan(filePath: string, span: PageSpan): unknown {
  const fd = fs.openSync(filePath, "r")
  try {
    return readSpanAt(fd, span)
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 读一段前缀，在其中找 `layoutParsingResults` 后面那个左括号的绝对偏移。
 *
 * 前缀不够就翻倍（64KB → 512KB → 4MB → 8MB），找不到就返回 null。
 * 返回的 `buf` 一并交回去，让调用方就地扫掉，不必重读。
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
 * 状态机本体；`base` 是这一块在文件里的绝对偏移（元素起点要记绝对位置）。
 * 返回 true 表示可以收工：数组结束，或已经拿到 `limit` 个元素。
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
