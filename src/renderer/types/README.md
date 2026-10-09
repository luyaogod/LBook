# src/renderer/types

## 这个目录做什么

渲染层使用的领域类型。它们**只是再导出**，定义在 `src/shared/types.ts`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `index.ts` | 从 `@shared/types` 再导出 `PdfDocument`、`OcrPage`、`OcrBlock` 等 |

## 对外接口

上述类型的再导出。

## 依赖方向

被渲染层各处 import。依赖 `src/shared/types.ts`，**不依赖 `electron`**。

这样做的目的是保证主进程与渲染层对同一份数据不可能有两种理解。**不要在这里重新定义类型。**

## 相关文档

- 父级：[../README.md](../README.md)
