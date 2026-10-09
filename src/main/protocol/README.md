# src/main/protocol

## 这个目录做什么

服务 `lbook://` 自定义协议——即 DOM 用 URL 天然加载的东西：书籍封面与包内资源。

它**不**服务 PDF。pdf.js 只对 http(s) 发范围请求，因此 PDF 走 IPC，理由见 `DESIGN.md` 第 4.2 节。

## 关键文件

| 文件 | 说明 |
|---|---|
| `lbookProtocol.ts` | `registerLbookProtocol(context)`：解析 `lbook://cover/<uid>` 与 `lbook://asset/<uid>/<entry>`，按扩展名给出 MIME |

## 对外接口

`registerLbookProtocol()`。

## 依赖方向

被 `src/main/index.ts` 调用。依赖 `electron` 的 `protocol`、`src/main/lbook/reader.ts`、`src/main/context.ts`。

`app://` 的处理函数留在 `src/main/index.ts` 里，因为它与窗口创建共享渲染层目录常量。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 4 节（自定义协议）
