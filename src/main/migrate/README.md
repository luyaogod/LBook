# src/main/migrate

## 这个目录做什么

**一次性**把旧的 `.lbook` 包读成书文件夹所需的全部代码。

它**不**属于运行时：主进程不 import 这里的任何东西，只有 `scripts/migrate-folders.ts` 用它。因此 `yauzl` 是 devDependency，装机包里没有它——应用本身已经完全不认识 `.lbook`（A12）。

`zipReader.ts` 与 `manifest.ts` 是从 `src/main/lbook/` **搬过来的原样代码**：包格式解析没有变，只是读它的理由从"每次打开书"变成了"迁移时读一次"。迁移做完之后，这个目录连同 `yauzl` 依赖可以整体删掉（见 `.agents/plan/01-phase1-folder-read.md` 的 T8 与 `03-phase3-drop-sqlite.md`）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `zipReader.ts` | `ZipArchive`：中央目录索引、由**局部文件头**解析数据偏移、STORE 条目的字节区间读取、DEFLATE 条目的整条解压。原 `src/main/lbook/zipIndex.ts` |
| `manifest.ts` | `manifest.json` 的解析与条目名常量（`ENTRY_PDF` / `ENTRY_OCR` / `ENTRY_TOC` / `ENTRY_MANIFEST`）、`slugify()`、`packageFileName()`。原 `src/main/lbook/manifest.ts` |
| `lbookToFolder.ts` | （**待建**，T8）逐本包 → 书文件夹的转换：解包 `book.pdf`（边写边算 sha256）、`ocr.json` 逐字节写出、`meta.json`、台账条目、进度条目 |

## 对外接口

`ZipArchive`、`ZipEntryInfo`、`isSafeEntryName()`、`withArchive()`；`parseManifest()`、`ENTRY_*`、`slugify()`、`packageFileName()`。

## 依赖方向

被 `scripts/migrate-folders.ts` 使用（**待建**）。依赖 `yauzl`、`node:zlib`、`src/shared/bookFile.ts`，**不依赖 `electron`**，主进程也不依赖它。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../.agents/plan/01-phase1-folder-read.md`](../../../.agents/plan/01-phase1-folder-read.md)（T8）、[`../../DESIGN.md`](../../../DESIGN.md) 第 6 节（旧格式规范）
