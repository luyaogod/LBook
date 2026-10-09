# tests/helpers

## 这个目录做什么

测试夹具构造器。把"造一个临时库""造一个 `.lbook`"这类样板收敛到一处。

## 关键文件

| 文件 | 说明 |
|---|---|
| `temp.ts` | `createTestContext()`（临时目录 + 已迁移的库）、`createLibraryTestContext()`（再加库目录）、`insertDocument()` |
| `lbook.ts` | `buildLbook()`（走 yazl 正常写入路径）、`writeRawZip()`（手工构造 ZIP，用于 yazl 拒绝生成的条目名）、`fakePdf()` |

## 对外接口

上述函数与 `TestContext`、`LibraryTestContext`、`BuildBookOptions`、`BuiltBook` 类型。

## 依赖方向

被 `tests/unit/**` 引用。依赖 `src/main/db/`、`src/main/lbook/`、`yazl`。

夹具里的 `fakePdf()` 会产生以 `%PDF-` 开头的真实字节，这样区间读取的断言才有意义。

## 相关文档

- 父级：[../README.md](../README.md)
