# src/renderer

## 这个目录做什么

React 渲染层：首页书目列表与 PDF 阅读器（单页模式 + Flow 连续滚动模式），带 OCR 块侧栏与叠加层。

它**不**直接访问文件系统或数据库——一律通过 `window.api`。

## 关键文件

| 文件 | 说明 |
|---|---|
| `App.tsx` | 顶层：首页↔阅读器切换、缩放、当前页、Flow 模式、目录栏与 OCR 栏的显隐/宽度/占满、键盘快捷键、阅读进度防抖保存、未保存提示 |
| `main.tsx` | React 入口 |
| `index.html` | 页面骨架，经 `app://bundle` 提供 |
| `index.css` | Tailwind v4 主题令牌与 `.markdown-body` 样式 |
| `global.d.ts` | 声明 `window.api` |

## 对外接口

无——它是叶子。构建产物在 `out/renderer/`，由主进程的 `app://` 处理器提供。

## 依赖方向

依赖 `src/shared` 的类型与 URL 构造器、`window.api`（预加载桥）、`pdfjs-dist`、React 生态。**不依赖 `electron`**，也不 import Node 内置模块——即使代码运行在 Electron 里，它也只是普通网页。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[api/README.md](./api/README.md)、[components/README.md](./components/README.md)（内含 [settings/README.md](./components/settings/README.md)、[translate/README.md](./components/translate/README.md)）、[hooks/README.md](./hooks/README.md)、[types/README.md](./types/README.md)
- 相关：[../../DESIGN.md](../../DESIGN.md)
