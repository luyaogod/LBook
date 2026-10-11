# src/renderer/api

## 这个目录做什么

对 `window.api` 的薄封装，让上层 hook 与组件的调用形式与改造前的 REST 时代保持一致。

它**不**缓存、不重试、不做业务判断。

## 关键文件

| 文件 | 说明 |
|---|---|
| `pdfs.ts` | 书目列表、单本元数据、**打开一个书文件夹**（`openBookFolder()`）、从书库移除、在文件管理器中显示、读一页 OCR、读 `toc.json` |
| `pdfs.ts` 里的 `readField()` / `writeField()` | 内容修正：读一个字段、把修正写回 `ocr.json`。**一次一个字段**（块的 `block_content` 或这一页的 `markdown.text`），`pageIndex` 用的是文件自己的 0 基编号（A8）；`baseValue` 是编辑器打开时读到的文本，用于拒绝覆盖别人的改动 |
| `users.ts` | 阅读进度（按 `uid`） |
| `translate.ts` | 划词翻译与朗读 |

## 对外接口

`fetchBooks()`、`fetchBook()`、`openBookFolder()`、`removeBook()`、`revealBook()`、`fetchPdfPage()`、`fetchBookToc()`；`fetchReadingProgress()`、`saveReadingProgress()`。

## 依赖方向

被 `src/renderer/hooks/` 与 `src/renderer/components/` 调用。只依赖 `src/shared` 的类型与 `window.api`。**不依赖 `electron`**。

三点要注意：

- 书一律用 **`uid`** 称呼（书文件夹 `meta.json` 里的身份），不是行号，也不是路径。
- `fetchBook()` 与 `fetchPdfPage()` 可能返回 `null`（书已被移除 / 该页不在 OCR 文件里），调用方必须处理。
- `removeBook()` 只让应用忘掉这本书：**磁盘上的文件夹一个字节都不动**（A11），UI 的文案必须说清楚这一点。

## 相关文档

- 父级：[../README.md](../README.md)
