# tests/unit/migrate

## 这个目录做什么

一次性迁移器的测试：一本 `.lbook` → 一个书文件夹。这里用的是**真的 ZIP 包**（`tests/helpers/lbookPackage.ts` 用 yazl 写出来，`ocr.json` 是 DEFLATE、`book.pdf` 是 STORE，与真库那 5 本同构），不是假对象。

## 关键文件

| 文件 | 说明 |
|---|---|
| `lbookToFolder.test.ts` | 迁移成功时：文件夹按 `slugify(title)` 落地、`meta.json` 沿用包内 `uid`（进度与封面 URL 都指着它）、`book.pdf` 字节相同且 sha256 等于包内自报的那份、**`ocr.json` 逐字节相同**（不是重新序列化）、`toc.json` 与封面一起搬过来；manifest 谎报页数时**以 OCR 文件为准并报出差异**；PDF 哈希对不上/没有 `ocr.json`/OCR 没有页/根本不是包 → 四种失败各自有说明，且**不留半个文件夹**；再跑一次 → 跳过（有台账时按 uid、没台账时按文件夹里的 `meta.json`）；同名不同 uid → `-2` 且原来那本不动；`--dry-run` 只出计划不写盘 |

## 对外接口

无。

## 依赖方向

引用 `src/main/migrate/**`、`src/shared/bookFile.ts` 与 `tests/helpers/lbookPackage.ts`。

这一组用例的意义是"迁移可以反复跑、而且跑坏了也不会毁掉原库"：断言里既有字节级相等，也有"失败后目录里必须是空的"。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../../.agents/plan/01-phase1-folder-read.md`](../../../.agents/plan/01-phase1-folder-read.md)（T8）
