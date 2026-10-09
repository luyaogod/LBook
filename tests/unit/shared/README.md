# tests/unit/shared

## 这个目录做什么

`src/shared/` 里纯函数的用例。这些模块同时被主进程与渲染层引用，因此它们的契约一旦漂移，两边会同时出错。

## 关键文件

| 文件 | 说明 |
|---|---|
| `toc.test.ts` | `toc.json` 的解析与校验规则、扁平化、当前条目判定、祖先路径 |

## 对外接口

无。

## 依赖方向

引用 `src/shared/toc.ts`。不触及文件系统，不 import `src/main`。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../TEST.md](../../../TEST.md)、[../../../DESIGN.md](../../../DESIGN.md) 第 6 节
