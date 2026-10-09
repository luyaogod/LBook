# src/renderer/components/toc

## 这个目录做什么

阅读器左侧的目录树。条目来自书本包内的 `toc.json`，点击即跳转到该条目对应的**扫描页**（不是纸面印的页号）。

它**不**负责：解析或校验 `toc.json`（那是 `src/shared/toc.ts` 的职责），也不负责增删目录——增删改都在首页的 Upload / Edit 对话框里完成，这里只是阅读辅助。

## 关键文件

| 文件 | 说明 |
|---|---|
| `TocPanel.tsx` | 树体。展开/折叠、当前阅读条目高亮与自动滚入视野、页码徽标、空状态与错误提示。**自身没有任何按钮** |

## 对外接口

`TocPanel` 与 `TocPanelProps`。

## 依赖方向

被 `src/renderer/App.tsx` 引用；`App.tsx` 通过 `hooks/useBookToc.ts` 拿到扁平化后的条目。依赖 `src/shared/toc.ts`（`flattenToc` 的产物、`findActiveTocId`、`tocAncestorIds`）与 `lucide-react`。**不依赖 `electron`**。

树的层级深度不固定（`toc.json` 允许嵌套），所以这里渲染的是扁平列表并按 `depth` 缩进，而不是递归组件——展开状态因此只是一个 id 集合。

展开状态记的是**被折叠的子树**（默认全展开），所以在阅读中被折叠的章不会因为翻页被强行重新打开：当前条目若落在折叠的子树里，就高亮它最近的可见祖先。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../../DESIGN.md](../../../../DESIGN.md) 第 6 节（`toc.json` 格式）
