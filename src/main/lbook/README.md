# src/main/lbook

## 这个目录做什么

`.lbook` 包格式的全部读写逻辑。这是本项目技术含量最高的一块。

它**不**负责：决定书在库里的位置（那是 `library/`），也不碰数据库。

## 关键文件

| 文件 | 说明 |
|---|---|
| `offsetIndex.ts` | **大 OCR JSON 的按页随机访问**：流式扫出 `layoutParsingResults[]` 每个元素的字节区间，再按偏移取单页。内存与文件大小无关（实测与取舍见 `PLAN.md` 4.2） |
| `zipIndex.ts` | `ZipArchive`：中央目录索引、由**局部文件头**解析数据偏移、STORE 条目的字节区间读取、DEFLATE 条目的整条解压 |
| `archiveCache.ts` | 打开句柄的 LRU 缓存。**缓存的是 pending Promise 而非已解析实例**——否则并发调用会各开一次并泄漏一个句柄 |
| `manifest.ts` | manifest 解析/构造、条目名常量、`slugify()`、`packageFileName()` |
| `validate.ts` | 包校验。`book.pdf` 非 STORE 报硬错误 |
| `reader.ts` | 只读门面：`readPdfRange`、`readManifest`、`readOcrJson`、`readCover`、`readToc`、`readEntryText`、`pdfSize`、`pdfDataStart`、`closeBook` |
| `packer.ts` | `packLbook()` 从零打包；`repackLbook()` 重写包，PDF 段**逐字节复制** |
| `ocr.ts` | PaddleOCR JSON 的解析、校验与 `detectHtml()` |
| `reconstruct.ts` | `buildOcrJsonFromDb()`：从库重建 OCR 载荷。保存与迁移共用同一函数 |

## 对外接口

`PageSpan`、`scanPageSpans()`、`readSpanAt()`、`readSpan()`；`ZipArchive`、`ZipEntryInfo`、`isSafeEntryName()`、`withArchive()`；缓存：`getArchive()`、`closeArchive()`、`closeAllArchives()`、`openArchiveCount()`；读取门面（见上表）；打包：`packLbook()`、`repackLbook()`；解析：`parseOcrPayload()`、`validateOcrJson()`、`detectHtml()`；重建：`buildOcrJsonFromDb()`、`mergeBlocks()`。

## 依赖方向

被 `src/main/library/`、`src/main/protocol/`、`scripts/` 使用。依赖 `yauzl`、`yazl`、`node:zlib`，**不依赖 `electron`**。

两条不可动摇的约定，改动前务必读 `DESIGN.md`：
1. `book.pdf` 必须 STORE 且排在包内首位。
2. `reconstruct.ts` 的块重建是**合并**（`pruned_result` 为底、`ocr_blocks` 覆盖内容），不是替换。

第三条容易被忽略：**`repackLbook()` 从头重建整个压缩包**，没被显式写回的条目就消失了。调用方（`library/service.ts` 的 `repackPackage()`）必须把本次不改动的 `ocr.json` / `toc.json` / 封面读回来再传进去。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 6 节（`.lbook` 格式）
