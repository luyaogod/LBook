# src/preload

## 这个目录做什么

主进程与渲染层之间**唯一**的桥梁。在沙箱中运行，把主进程能力以**具名白名单**的形式挂到 `window.api`。

它**绝不**暴露泛化的 `invoke(channel, payload)`——那等于把整个主进程交给渲染层。

## 关键文件

| 文件 | 说明 |
|---|---|
| `index.ts` | 实现 `LbookApi`，经 `contextBridge.exposeInMainWorld('api', …)` 暴露；并探测 `webUtils.getPathForFile` 是否可用（结果放在 `capabilities.filePaths`） |

## 对外接口

运行时暴露 `window.api`（类型见 `src/shared/ipc.ts` 的 `LbookApi`）；渲染层的全局声明在 `src/renderer/global.d.ts`。

## 依赖方向

被 Electron 作为 preload 加载。依赖 `electron`（`contextBridge`、`ipcRenderer`、`webUtils`）与 `src/shared/ipc.ts`。

**必须构建为 CJS**——`sandbox: true` 不支持 ESM 预加载脚本，这也是 `scripts/build.mjs` 输出 `.cjs` 的原因。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../DESIGN.md](../../DESIGN.md) 第 3 节（进程模型）
