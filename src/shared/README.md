# src/shared

## 这个目录做什么

主进程、预加载与渲染层三方共享的契约与纯函数。它是三方唯一能互相看到的代码，因此**必须零依赖**。

它**不**负责：任何运行时逻辑、任何 I/O、任何 Electron API。

`toc.ts` 例外地承载了一点逻辑（解析、校验、定位），但它是纯函数且零依赖——渲染层要靠它把扁平条目画成树，主进程要靠它拒绝一份写错的 `toc.json`，两边用同一份规则才不会各说各话。

## 关键文件

| 文件 | 说明 |
|---|---|
| `ipc.ts` | IPC 通道常量、每个通道的请求/响应类型表、`LbookApi` 暴露面定义 |
| `types.ts` | 领域类型：`PdfDocument`、`OcrPage`、`OcrBlock`、`BookManifest`、`BookToc` 等 |
| `toc.ts` | 目录树契约：`toc.json` 的解析与校验、扁平化、当前条目定位 |
| `translate.ts` | 翻译契约：供应商自述字段、设置视图、译文结果 |
| `bookFile.ts` | 书籍 `meta.json` 的契约：解析（**不抛异常**）、写出（固定键序）、以及"`ocrFile` 不得跳出书文件夹"的路径校验 |
| `ledger.ts` | 书库台账的形状与校验：`library.json` 的解析/序列化（纯函数，路径语义归 main） |
| `urls.ts` | `lbook://` URL 构造器与 OCR 内容里的相对图片引用重写 |

## 对外接口

`IPC`、`IPC_MAP` 类型、`LbookApi`、`UpdateStatus`、`Settings`、`SettingsPatch`、`READING_FONT_SIZE`、`ScanResult`、`FileKind`；`BookMeta`、`parseBookMeta()`、`writeBookMeta()`、`isSafeBookFileName()`、`BOOK_FORMAT_VERSION`；`Ledger`、`BookRef`、`parseLedger()`、`serializeLedger()`、`emptyLedger()`、`LEDGER_VERSION`；`PdfDocument` 等全部领域类型；`parseToc()`、`flattenToc()`、`findActiveTocId()`、`tocAncestorIds()`、`countTocNodes()`、`TOC_FORMAT_VERSION`；`coverUrl()`、`assetUrl()`、`resolveAssetUrls()`。

## 依赖方向

被 `src/main`、`src/preload`、`src/renderer` 与 `tests/` 引用。**不依赖任何东西**——没有 `electron`，没有 Node 内置模块，无副作用。这是它能在纯 Node 测试里直接 import 的原因。

## 相关文档

- 父级：[../README.md](../README.md)
- 同级：[main/README.md](../main/README.md)、[renderer/README.md](../renderer/README.md)
- 相关：[../../DESIGN.md](../../DESIGN.md) 第 7 节（IPC 契约）
