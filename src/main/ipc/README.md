# src/main/ipc

## 这个目录做什么

把 `Library`、进度、设置、翻译与 updater 暴露成 IPC 通道。它是主进程唯一的"接口层"。

它**不**实现业务逻辑：校验与读写在 `library/`、`progress.ts`、`config/` 里。这里只做三件事——转发、把异常变成干净的字符串、在书库变化时广播。

## 关键文件

| 文件 | 说明 |
|---|---|
| `register.ts` | `registerIpcHandlers(context, updater)`：注册全部 `ipcMain.handle`，并向所有窗口广播 `library:changed` 与 `updates:status` |

两条值得写下来的约定：

- **`library:open` 自己弹目录选择框。** 渲染层不传路径时，主进程弹它自己的 `showOpenDialog({ properties: ["openDirectory"] })`：路径只从对话框流向渲染层，渲染层永远不构造路径。返回 `null` 表示用户取消了——那不是一个错误。
- **写通道已经全部消失。** `book:save` / `book:updateBlock` / `book:replaceOcr` / `book:replaceCover` / `book:replaceToc` / `book:clearToc` / `library:scan` / `library:import` / `library:createFromFiles` / `library:delete` / `settings:chooseLibraryDir` / `settings:revealLibraryDir` / `dialog:pickFiles` 都不再存在：应用对书的内容只读（A5），"删除"只是台账里去掉一条（A11），新增书籍是"打开一个文件夹"（A12）。

## 对外接口

`registerIpcHandlers()`、`IpcHandlerHooks`。

## 依赖方向

被 `src/main/index.ts` 调用。依赖 `electron`（`ipcMain`、`dialog`、`shell`、`BrowserWindow`）、`src/main/context.ts`、`src/shared/ipc.ts`。

通道名与类型一律取自 `src/shared/ipc.ts`，**不要在渲染层或预加载里硬编码字符串**。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md) 第 7 节（IPC 契约）
