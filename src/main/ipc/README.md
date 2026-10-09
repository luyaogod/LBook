# src/main/ipc

## 这个目录做什么

把 `LibraryService` 与 updater 暴露成 IPC 通道。它是主进程唯一的"接口层"。

它**不**实现业务逻辑，也不做数据校验（校验在 service 与 importer 里）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `register.ts` | `registerIpcHandlers(context, updater)`：注册全部 `ipcMain.handle`，并向所有窗口广播 `library:changed` 与 `updates:status` |

`book:replaceToc` 与 `book:replaceOcr` 一样只收**路径**：文件选择发生在渲染层的 `<input type="file">` 里，主进程不弹自己的对话框。`book:clearToc` 是它没有文件可传时的对应操作（"移除目录"）。

## 对外接口

`registerIpcHandlers()`。

## 依赖方向

被 `src/main/index.ts` 调用。依赖 `electron`（`ipcMain`、`dialog`、`shell`、`BrowserWindow`）、`src/main/context.ts`、`src/main/library/`、`src/shared/ipc.ts`。

通道名与类型一律取自 `src/shared/ipc.ts`，**不要在渲染层或预加载里硬编码字符串**。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 7 节（IPC 契约）
