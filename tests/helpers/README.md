# tests/helpers

## 这个目录做什么

测试夹具构造器。把"造一本合法的书文件夹""造一个 `.lbook` 包"这类样板收敛到一处。

## 关键文件

| 文件 | 说明 |
|---|---|
| `bookFolder.ts` | `createBookFolder()`（写出真实布局：`meta.json` + `ocr.json` + `book.pdf`，可选 `toc.json` 与封面）、`pageElement()`、`createTempRoot()` |
| `lbookPackage.ts` | `buildLbook()`（用 yazl 写出货真价实的 `.lbook`，含压缩的 `ocr.json`）、`fakePdf()`。**只服务于一次性迁移的测试** |

## 对外接口

`createBookFolder()`、`pageElement()`、`createTempRoot()`、`BookFolder`、`BookFolderOptions`；`buildLbook()`、`fakePdf()`、`BuildBookOptions`、`BuiltBook`。

## 依赖方向

被 `tests/unit/**` 引用。`bookFolder.ts` 依赖 `src/shared/bookFile.ts`（只用 `writeBookMeta`，保证夹具写出的 `meta.json` 与迁移写出的一模一样）；`lbookPackage.ts` 依赖 `src/main/migrate/manifest.ts`、`yazl`、`node:zlib`。

夹具里的 `fakePdf()` 会产生以 `%PDF-` 开头的真实字节，这样区间读取与"逐字节拷贝"的断言才有意义。**夹具一律在 `os.tmpdir()` 下生成**，绝不碰真实的 `%APPDATA%\LBook` 或用户的库。

## 相关文档

- 父级：[../README.md](../README.md)
