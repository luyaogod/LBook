# src/main/lbook

## 这个目录做什么

**大 OCR JSON 的读法**：把它当一个"可以按页随机访问"的文件，而不是每次整份 `JSON.parse`。

它**不**负责：书在哪儿（那是 `library/`）、书库列表（台账）、进度。它也**不认识 `.lbook`**——旧包格式的读取与转换在 Phase 3 已经删除（一次性迁移做完了，代码留在 git 历史里）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `offsetIndex.ts` | **按页随机访问**：流式扫出 `layoutParsingResults[]` 每个元素的字节区间（`scanPageSpans`），再按偏移读出并解析单页（`readSpanAt` / `readSpan`）。内存与文件大小无关（实测与取舍见 `PLAN.md` 4.2） |
| `ocr.ts` | 把**一个页元素**映射成渲染层形状：`prunedResult.parsing_res_list` → `OcrBlock[]`、`markdown.text` → `markdown_text`、`prunedResult.width/height` → 页尺寸（缺失时按 bbox 推）。全部纯函数 |

## 对外接口

`PageSpan`、`ScanResult`、`scanPageSpans()`、`readSpanAt()`、`readSpan()`；`toOcrPage()`、`toOcrBlock()`、`toOcrBlocks()`、`pageSizeOf()`。

## 依赖方向

被 `src/main/library/`（读书）、`scripts/perf-probe.ts`（量性能）与 `tests/` 使用。只依赖 `node:fs` / `node:path`，**不依赖 `electron`**，也不依赖任何第三方包。

三条不可动摇的约定，改动前务必读 `.agents/plan/00-decisions.md`：

1. **页号 = `layoutParsingResults` 的数组下标**（A8）。PaddleOCR 的元素里没有页号字段，所以删掉或插入一个元素会让后面整体错位——上层必须拿 `meta.pageCount` 兜底校验。
2. **扫描器全程流式**，内存里不出现整个文件（A3）。跨块不需要残留缓冲：`{ } [ ] " \` 都是单字节 ASCII，多字节 UTF-8 只可能出现在字符串内部。
3. **`ocr.json` 逐字节原样**（A7）。应用不重排、不 pretty-print、不改键序，也不派生第二份数据（A10）。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../.agents/plan/baseline.md`](../../../.agents/plan/baseline.md)（实测数据）、[`../../../DESIGN.md`](../../../DESIGN.md) 第 5 节
