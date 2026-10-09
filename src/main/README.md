# src/main

## 这个目录做什么

Electron 主进程。唯一有权访问数据库、文件系统、`.lbook` 包与网络的层。

它**不**负责：任何 UI。渲染层通过 IPC 请求它做事，它从不反向操作 DOM。

## 关键文件

| 文件 | 说明 |
|---|---|
| `index.ts` | 进程入口：注册 privileged scheme、`app://` 处理、CSP、建窗、装配 AppContext 与 updater |
| `context.ts` | `createAppContext()`：把路径、仓储、库服务、配置串成一个可注入的整体 |
| `paths.ts` | 路径解析。**全仓库唯一读取 `app.getPath()` 的地方在 index.ts**，其余靠这里向下传 |
| `updater.ts` | electron-updater 封装：静默检查、后台下载、退出时装 |
| `theme.ts` | 把主题设置同步给 Electron：`nativeTheme.themeSource`（决定渲染层的 prefers-color-scheme）与无边框窗口的标题栏/背景色 |

## 对外接口

`createAppContext()` 与 `AppContext` 类型；`resolvePaths()`、`defaultLibraryDir()`、`AppPaths`；`createUpdater()`、`Updater`、`UpdateStatus`。

## 依赖方向

被 `src/preload`（仅类型层面共享 `src/shared`）之外的任何层都不直接引用。它自己引用 `src/shared`，以及同目录下的 `db/`、`lbook/`、`library/`、`ipc/`、`protocol/`、`config/`。

**本目录（以及 context/paths）是唯一允许 import `electron` 的地方之一**；其子目录中只有 `ipc/` 与 `protocol/` 也用 Electron，其余子目录必须是纯 Node。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[config/README.md](./config/README.md)、[db/README.md](./db/README.md)、[ipc/README.md](./ipc/README.md)、[lbook/README.md](./lbook/README.md)、[library/README.md](./library/README.md)、[protocol/README.md](./protocol/README.md)、[tencent/README.md](./tencent/README.md)、[translate/README.md](./translate/README.md)
- 相关：[../../DESIGN.md](../../DESIGN.md) 第 3 节（进程模型）
