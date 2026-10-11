# tests/unit/shared

## 这个目录做什么

`src/shared/` 里纯函数的用例。这些模块同时被主进程与渲染层引用，因此它们的契约一旦漂移，两边会同时出错。

## 关键文件

| 文件 | 说明 |
|---|---|
| `validateBook.test.ts` | 校验规则：缺/坏 `meta.json`、`ocr.json` 缺文件/无数组/空数组/坏页（带字节偏移与 JSON 路径）、页数三方不一致、PDF 文件头、`toc.json` 复用既有解析器；**永不抛异常**（一堆恶意输入各跑一遍）；`checkOcrPage` 的逐页规则 |
| `toc.test.ts` | `toc.json` 的解析与校验规则、扁平化、当前条目判定、祖先路径 |
| `bookFile.test.ts` | `meta.json` 契约：完整文件、缺 title 不当错、未知键忽略、更高 formatVersion 拒绝、必需字段缺失逐一拒绝、**`ocrFile` 不得跳出文件夹**（`../`、子目录、盘符、绝对路径）、垃圾输入只报错不抛；写出的键序稳定且能往返 |

## 对外接口

无。

## 依赖方向

引用 `src/shared/toc.ts`。不触及文件系统，不 import `src/main`。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md)、[../../../DESIGN.md](../../../DESIGN.md) 第 6 节
