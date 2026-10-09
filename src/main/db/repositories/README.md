# src/main/db/repositories

## 这个目录做什么

把表映射成领域对象。每个文件是一张表（或一族相关表）的读写入口。

## 关键文件

| 文件 | 说明 |
|---|---|
| `documents.ts` | `pdf_documents`。`toDocument()` 把行映射为渲染层类型，并派生 `cover_url` |
| `pages.ts` | `ocr_pages`。含 `insertPageWithBlocks()`，一次写入一页及其全部块 |
| `blocks.ts` | `ocr_blocks`。`parseBbox()` 解析 JSON 数组，`updateContent()` 顺带重算 `is_html_content` |
| `progress.ts` | `reading_progress`。upsert 并对 1..page_count 越界返回 null |
| `users.ts` | `users`。单用户模型，`getOrCreateAdmin()` 幂等 |

## 对外接口

每个仓储的 `createXRepo(db)` 工厂与其 `XRepo` 类型；行类型 `DocumentRow`、`PageRow`、`BlockRow`；映射函数 `toDocument()`、`toBlock()`、`parseBbox()`。

## 依赖方向

被 `src/main/library/`（经 `src/main/db/index.ts` 装配）使用。只依赖 `better-sqlite3` 类型与 `src/shared/types.ts`，**不依赖 `electron`**。

仓储方法内部不写 `this`——写成闭包内的具名函数，避免调用方解构后 `this` 失效。

## 相关文档

- 父级：[../README.md](../README.md)
