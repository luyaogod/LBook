# src/main/library

## 这个目录做什么

业务层：把"一个 `.lbook` 文件"变成"库里一本可读的书"。它连接 `db/` 与 `lbook/`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `service.ts` | `createLibraryService()`：列表、读取、扫描、导入、创建、保存、替换、删除、进度（**写半边在 Phase 1 会被删掉**） |
| `book.ts` | **读一本书文件夹**：`openBook()`（懒扫偏移索引，**不持有文件句柄**）、`readTocText()`、`coverPath()` |
| `ledger.ts` | **书库台账**（`library.json`）：增/删/列路径，`resolve()` 给出绝对目录；**`remove()` 从不碰磁盘** |
| `importer.ts` | `importPackage()`：把包索引进库。**有未保存编辑时拒绝重导入** |
| `legacy.ts` | 只读旧版 `backend/lbook.db`，并重建其 OCR 载荷。迁移与黄金测试共用 |
| `hash.ts` | `sha256File()`，流式，不把 200MB 读进内存 |

## 对外接口

`createLibraryService()` 与 `LibraryService`；`openBook()`、`readTocText()`、`coverPath()`、`OpenBook`；`createLedgerStore()`、`LedgerStore`；`importPackage()`、`ImportSkipped`；`readLegacyDocuments()`、`readLegacyProgress()`、`reconstructLegacyBook()`；`sha256File()`。

## 依赖方向

被 `src/main/context.ts`（装配）、`src/main/ipc/register.ts`（暴露为 IPC）与 `scripts/migrate-legacy.ts` 使用。依赖 `db/`、`lbook/`、`src/shared`，**不依赖 `electron`**。

保存采用 Excel 模型：编辑先进数据库，显式保存时才写回 `.lbook`。写回前必须 `await closeBook()` 释放句柄，否则 Windows 上的重命名会 EPERM。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 5 节
