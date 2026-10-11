# tests/unit/renderer

## 这个目录做什么

渲染层的**纯逻辑**：不碰 DOM、不碰 React、不碰 `window.api`，因此可以在 node 环境里直接测。

它**不**测 React 组件的渲染（那需要 jsdom/Electron，见 `TEST.md` 第 7 节），也不测 IPC 封装（`src/renderer/api/*`，那是一层转发）。所以放在 `src/renderer/lib/` 下的东西要尽量保持"能脱离浏览器跑"。

## 关键文件

| 文件 | 说明 |
|---|---|
| `assetUrl.test.ts` | `imgs/x.jpg` → `lbook://asset/<uid>/imgs/x.jpg`；绝对 URL 与协议相对 URL 不动；不误伤正文文本 |
| `editHistory.test.ts` | 会话内勘误历史：每条只留差异（前后两个字符串，多字节/换行/引号原样）；按书隔离；`newestEdit` 指向撤销目标；`forgetEdit` 只删一条、删不存在的 id **不动快照**；上限 50 条丢最旧；订阅收到通知、退订后不再收到。另外专门测了两条 React 相关的不变量——**没变时快照保持同一引用**（否则 `useSyncExternalStore` 会无限重渲染），**变了必须换新数组**（否则 React 看不见变化）；以及 `snippetOf` 的空白折叠与截断 |

## 对外接口

无。

## 依赖方向

引用 `src/renderer/lib/editHistory.ts`（它只 `import type`，不引入 React 与 IPC）。不依赖 `electron`。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../src/renderer/lib/README.md`](../../../src/renderer/lib/README.md)、[`../../../.agents/plan/04-phase4-content-edit.md`](../../../.agents/plan/04-phase4-content-edit.md)（T5）
