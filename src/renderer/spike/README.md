# src/renderer/spike

## 这个目录做什么

放**给检查用的页面**，不是给用户看的界面：`npm run check:editor` 会在一个隐藏的 Electron 窗口里加载这里的页面，让它导入**应用真正用的那个模块**（如 `../lib/sourceEditor`），然后把结果读回来。

它**不**是第二个入口、也不进应用自己的构建：`vite.spike.config.ts` 单独给它构建一份（原因写在那个文件里——rolldown 会把应用与编辑器共用的模块提升进**应用入口** chunk，vite 于是会先执行整个界面）。页面里不放产品逻辑，只放"能不能跑起来、样式有没有被 CSP 挡下"这类断言。

## 关键文件

| 文件 | 说明 |
|---|---|
| `index.html` | 检查页的骨架：一个 `#surface` 容器 + 引入 `codemirror.ts` |
| `codemirror.ts` | 源码编辑器在 `app://` 与生产 CSP 下的检查：装得上、样式生效、行号在、**markdown 语言支持是懒块且真的到了**（高亮 span 出现才算）、HTML 语言也能载入；同时收集 `securitypolicyviolation` 与 `console.error`，失败原因写进 `window.__editorSpike` 由探针打印 |

## 对外接口

无（页面只在探针里被打开）。

## 依赖方向

引用 `src/renderer/lib/sourceEditor.ts`。**不依赖 `electron`**（探针在 Electron 里跑，这个页面只是网页）。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../lib/README.md`](../lib/README.md)、[`../../../scripts/README.md`](../../../scripts/README.md)（`check-editor`）、[`../../../.agents/plan/04-phase4-content-edit.md`](../../../.agents/plan/04-phase4-content-edit.md)（T4）
