# src/main/migrate

## 这个目录做什么

**一次性**把旧的 `.lbook` 包读成书文件夹所需的全部代码。

它**不属于运行时**：主进程不 import 这里的任何东西，只有 `scripts/migrate-folders.ts` 用它。因此 `better-sqlite3` 与 `yauzl` 是 devDependency，装机包里没有它们——应用本身已经完全不认识 `.lbook`（A12）。

`zipReader.ts` 与 `manifest.ts` 是从 `src/main/lbook/` **搬过来的原样代码**：包格式没变，只是读它的理由从"每次打开书"变成了"迁移时读一次"。迁移跑完并确认无误后，这个目录连同那两个依赖可以整体删掉（`.agents/plan/03-phase3-drop-sqlite.md`）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `lbookToFolder.ts` | `migratePackage()`：一本包 → 一个书文件夹。全部规则都写在这个文件的头注释里，最要紧的四条：**原包一个字节都不动**、`ocr.json` **逐字节**拷贝、`book.pdf` 流式拷并**边写边算 sha256 与包内比对**、**全有或全无**（先建在 `.migrating-<uid8>` 再改名就位） |
| `zipReader.ts` | `ZipArchive`：中央目录索引、由**局部文件头**解析数据偏移、STORE 条目的字节区间读取、DEFLATE 条目的整条解压 |
| `manifest.ts` | `manifest.json` 的解析与条目名常量（`ENTRY_PDF` / `ENTRY_OCR` / `ENTRY_TOC` / `ENTRY_MANIFEST`）、`slugify()`、`packageFileName()` |

## 对外接口

`migratePackage()` 与 `MigrateOutcome`、`MigrateInput`；`ZipArchive`、`ZipEntryInfo`、`isSafeEntryName()`、`withArchive()`；`parseManifest()`、`BookManifest`、`ENTRY_*`、`slugify()`、`packageFileName()`。

## 依赖方向

被 `scripts/migrate-folders.ts` 与 `tests/unit/migrate/` 使用。依赖 `yauzl`、`node:zlib`、`node:crypto`、`src/shared/bookFile.ts`、`src/main/lbook/offsetIndex.ts`（数页数），**不依赖 `electron`**，主进程也不依赖它。

两个刻意的行为，写在代码里也写在这里：

- **页数取 `ocr.json` 的实际长度，不取 `manifest.pageCount`**。两者不一致时以文件为准，并把差值报出来（迁移输出里那句 `(manifest said N)`）——阅读器的总页数就是 `meta.json` 里这个数。
- **已经登记过的书直接跳过**，所以迁移可以反复跑；即使台账丢了，只要目标文件夹里的 `meta.json` 是同一个 `uid`，也会被认作同一本书而不是撞名。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../.agents/plan/01-phase1-folder-read.md`](../../../.agents/plan/01-phase1-folder-read.md)（T8）、[`../../DESIGN.md`](../../../DESIGN.md) 第 6 节（旧格式规范）
