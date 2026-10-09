# tests/unit/migration

## 这个目录做什么

旧数据迁移的保真度验证。这是整个套件里**价值最高**的一个目录。

## 关键文件

| 文件 | 说明 |
|---|---|
| `reconstruct.test.ts` | **黄金用例**：把 `backend/lbook.db` 第一本书重建成 PaddleOCR JSON，与 `dev-data/Oxford Picture Dictionary 3 ed.ocr.json` 比对 `dataInfo` / 每页 `prunedResult` / 每页 `markdown` 是否全部深度相等（294 页 / 8609 块） |

## 对外接口

无。

## 依赖方向

引用 `src/main/library/legacy.ts`。**依赖仓库外的两个文件**：`backend/lbook.db`（历史数据）与 `dev-data/*.ocr.json`（原始识别结果）。二者缺任一个，整个 describe 块跳过。

跳过是有意的：宁可不跑，也不要静默"通过"。

这份 `dev-data` 里的 JSON 是唯一一份未经数据库中转的真相——它是你和一次静默、不可恢复的数据丢失之间唯一的屏障。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md) 第 4 节
