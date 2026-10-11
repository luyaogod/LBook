# src/renderer/hooks

## 这个目录做什么

把 pdf.js 与 IPC 的异步细节封装成 React 状态。组件只消费状态，不直接碰 pdf.js。

## 关键文件

| 文件 | 说明 |
|---|---|
| `usePdfDocumentProxy.ts` | **最关键的 hook**：用 `IpcRangeTransport`（继承 `PDFDataRangeTransport`）经 IPC 分块取数，并加载 pdf.js worker |
| `useBook.ts` | 取一本已注册书的元数据（`library:get`） |
| `usePdfPage.ts` | 取单页 OCR 数据 |
| `useFlowPages.ts` | Flow 模式的页面缓存与相邻页预取 |
| `useBookChange.ts` | 订阅"这本书的文件变了"，返回一个自增的版本号；三个数据 hook 把它当 effect 依赖，于是**只换数据、不动页码与滚动位置** |
| `useEditHistory.ts` | 一本书的勘误历史与**唯一一处撤销**：从 `lib/editHistory.ts` 读（`useSyncExternalStore`），撤销就是再走一次 `writeField`（写 `before`、`after` 当 `baseValue`），成功才从历史里去掉。被拒时**不移除**——文件已经往前走了，留着比假装成功好 |
| `useBookToc.ts` | 读取书文件夹里的 `toc.json` 并摊平成树（只读：目录是用户的文件，应用不写回） |

## 对外接口

`usePdfDocumentProxy(bookId)`、`useBook(uid)`、`usePdfPage(uid, pageNum)`、`useFlowPages(uid)`、`useBookToc(uid)`、`useBookChange(uid)`、`useEditHistory(uid)`、`describeEntry(entry, t, snippet)`。

## 依赖方向

被 `src/renderer/components/viewer/` 与 `App.tsx` 使用。依赖 `pdfjs-dist`、`src/renderer/api/`、React。

**`usePdfDocumentProxy.ts` 里的两条契约不能凭直觉改**：IPC 的 `readPdfRange(begin, end)` 是**闭区间**，而 pdf.js 的 `requestDataRange(begin, end)` 是**排他**的（所以实现里减一）；传给 transport 的 `length` 必须是 `book.pdf` 的精确字节数，错了会直接报 "Invalid PDF structure"。

**另外两处是实测调出来的，改之前先看 `DESIGN.md` 4.3**：`rangeChunkSize` 用 512KB（64KB 时 178MB 的书要 ~2850 次异步往返）；`disableAutoFetch` **刻意不设**——关掉它实测让稳态翻页变慢（首绘中位 90ms vs 60ms）。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 4.2 节
