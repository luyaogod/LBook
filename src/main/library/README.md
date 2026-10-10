# src/main/library

## 这个目录做什么

业务层：把"磁盘上的一个书文件夹"变成"书库里一本可读的书"。

它**不**负责：OCR JSON 的字节级读法（那是 `lbook/`）、进度文件（`src/main/progress.ts`）、UI。它也**不再**扫描任何目录——书可以在任何地方（A11）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `library.ts` | `createLibrary()`：门面。`list()`/`get()` 读台账里的每一本；`open()` 把用户选的文件夹登记成书（没有 `meta.json` 时**创建**一个）；`getPage()`/`readPdfRange()`/`getToc()` 读书；`remove()` 只删台账条目；`progress` 读写进度 |
| `book.ts` | **读一个书文件夹**：`openBook()`（读 `meta.json`、懒扫偏移索引、**不持有文件句柄**）、`readTocText()`、`coverPath()` |
| `ledger.ts` | **书库台账**（`library.json`）的文件半边：增/删/列、`resolve()` 给出绝对目录、原子写；**`remove()` 从不碰磁盘**（A11） |
| `hash.ts` | `sha256File()`，流式，不把 200MB 读进内存。迁移校验 PDF 副本用 |

## 对外接口

`createLibrary()` 与 `Library`；`openBook()`、`readTocText()`、`coverPath()`、`OpenBook`；`createLedgerStore()`、`LedgerStore`；`sha256File()`。

## 依赖方向

被 `src/main/context.ts`（装配）与 `src/main/ipc/register.ts`（暴露为 IPC）使用。依赖 `lbook/`、`src/shared`、`src/main/progress.ts`，**不依赖 `electron`**，也不依赖 `db/`——那个目录已经删了（Phase 3 提前完成，因为读路径不再需要它）。

几个刻意的选择：

- **缓存 OpenBook，但不持有句柄。** 一个缓存的 `OpenBook` 只是它已经扫出来的页索引（665 页约几十 KB）加解析后的 `meta.json`；每读一页 open/close 一次文件，代价 0.01–0.05ms，换来的是 Windows 上"用户随时能改名/移动书文件夹"。
- **书不见了仍然列出来。** 文件夹被移走、`meta.json` 被删、`ocr.json` 不在，都会变成该条目的 `problem` 文案，而不是让这本从列表里消失（B8）——"书没了"和"书被删了"在界面上必须看得出来。
- **`open()` 是应用唯一的写操作。** 只有当用户要求"把这个文件夹加成书"、而该文件夹又没有 `meta.json` 时，才写一个 `meta.json`（页数取自 OCR 数组的实际长度）。除此之外应用对书的内容只读（A5）。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../.agents/plan/00-decisions.md`](../../../.agents/plan/00-decisions.md)（A11 / A5 / B8）、[`../../../DESIGN.md`](../../../DESIGN.md) 第 5 节
