# tests/unit/lbook

## 这个目录做什么

`.lbook` 包格式的读写与校验测试。这是整个套件里最接近"物理正确性"的部分。

## 关键文件

| 文件 | 说明 |
|---|---|
| `zipIndex.test.ts` | 中央目录索引、数据偏移解析、区间读取与越界钳制、压缩条目拒绝、条目名安全 |
| `reader.test.ts` | **`readPdfRange(uid,0,8)` 以 `%PDF-` 开头**；随机区间与原始字节一致；manifest/ocr/cover 读取；并发调用共享句柄 |
| `validate.test.ts` | DEFLATE 的 PDF、缺 manifest、格式串错、版本过高、恶意 `../` 条目、缺 book.pdf、截断包 |
| `manifest.test.ts` | manifest 解析容错；`slugify()` 边界（纯符号、非 ASCII、超长） |

## 对外接口

无。

## 依赖方向

引用 `src/main/lbook/**`、`src/shared/urls.ts` 与 `tests/helpers/lbook.ts`。

夹具用 `writeRawZip()` 手工构造恶意 ZIP——yazl 会拒绝生成 `../` 这类条目名，只有手工构造才能测到。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md) 第 3 节
