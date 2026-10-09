# src/renderer/api

## 这个目录做什么

对 `window.api` 的薄封装，让上层 hook 与组件的调用形式与改造前的 REST 时代保持一致。

它**不**缓存、不重试、不做业务判断。

## 关键文件

| 文件 | 说明 |
|---|---|
| `pdfs.ts` | 书目、页面、块编辑、保存、替换、创建、导入、扫描、目录读取与替换 |
| `users.ts` | 当前用户与阅读进度 |

## 对外接口

`fetchPdfs()`、`fetchPdfDetail()`、`fetchPdfPage()`、`fetchPdfPages()`、`updateBlock()`、`savePdf()`、`replaceOcr()`、`replaceCover()`、`fetchBookToc()`、`replaceBookToc()`、`clearBookToc()`、`createFromFiles()`、`importPackage()`、`scanLibrary()`；`fetchCurrentUser()`、`fetchReadingProgress()`、`saveReadingProgress()`。

## 依赖方向

被 `src/renderer/hooks/` 与 `src/renderer/components/` 调用。只依赖 `src/shared` 的类型与 `window.api`。**不依赖 `electron`**。

注意 `fetchPdfDetail()` 与 `fetchPdfPage()` 可能返回 `null`（书不存在 / 该页无 OCR 数据），调用方必须处理。

## 相关文档

- 父级：[../README.md](../README.md)
