# src/renderer/hooks

## 这个目录做什么

把 pdf.js 与 IPC 的异步细节封装成 React 状态。组件只消费状态，不直接碰 pdf.js。

## 关键文件

| 文件 | 说明 |
|---|---|
| `usePdfDocumentProxy.ts` | **最关键的 hook**：用 `IpcRangeTransport`（继承 `PDFDataRangeTransport`）经 IPC 分块取数，并加载 pdf.js worker |
| `usePdfDocument.ts` | 取 `PdfDocumentDetail` |
| `usePdfPage.ts` | 取单页 OCR 数据 |
| `useFlowPages.ts` | Flow 模式的页面缓存与相邻页预取 |
| `useBookToc.ts` | 读取包内 `toc.json` 并摊平成树（只读，增删改在首页对话框） |

## 对外接口

`usePdfDocumentProxy(pdfId)`、`usePdfDocument(pdfId)`、`usePdfPage(pdfId, pageNum)`、`useFlowPages(pdfId)`、`useBookToc(pdfId)`。

## 依赖方向

被 `src/renderer/components/viewer/` 与 `App.tsx` 使用。依赖 `pdfjs-dist`、`src/renderer/api/`、React。

**`usePdfDocumentProxy.ts` 里的两个常量不能凭直觉改**：`requestDataRange` 的 `end` 是**排他**的；传给 transport 的 `length` 必须是 `book.pdf` 的精确字节数。

**另外两处是实测调出来的，改之前先看 `DESIGN.md` 4.3**：`rangeChunkSize` 用 512KB（64KB 时 178MB 的书要 ~2850 次异步往返）；`disableAutoFetch` **刻意不设**——关掉它实测让稳态翻页变慢（首绘中位 90ms vs 60ms）。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 4.2 节
