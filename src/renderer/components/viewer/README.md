# src/renderer/components/viewer

## 这个目录做什么

PDF 阅读区的渲染与交互：单页模式、Flow 连续滚动模式、OCR 块叠加层、工具栏。

页面**保持纸白、不反色**（表格与图反色后不可信）；页面周围的"桌面"跟着主题走——浅色是 `#f8fafc` 的桌面灰，暗色直接取 `--background` 的纯黑，与页头同色。两侧那两条 6px 拖拽分隔条（在 `App.tsx` 里）也刷成同一个桌面色，否则它们透出的窗口底色会在"面板—桌面"之间各留一道黑缝；同时每条分隔条里还放了一个与工具栏同高同盒模型的元素，把工具栏的下边线接过去——不然那条线在两端各缺一截，看起来像断的。

**流式模式把"已加载"和"已绘制"分开**：窗口内每一页都有数据与占位，但只有进入观察器外扩带（±900px）或跳转直接指向的页才拥有 canvas，集合上限 6 页并按窗口裁剪。原因是原先每页挂载即按 DOM 顺序全画，读者正看的那页排在视口外几页之后（实测 204–858ms）；现在流式跳页 34–43ms。跳转用瞬移而**不是**平滑滚动——平滑滚动会扫过沿途每一页、把它们全部排进绘制队列。细节与全部实测数字见 `DESIGN.md` 4.3。

它**不**负责侧栏内容（那是 `sidebar/`），也不持有全局状态——缩放、当前页、Flow 开关都由 `App.tsx` 传入。

## 关键文件

| 文件 | 说明 |
|---|---|
| `PdfViewer.tsx` | 单页模式。监听 Ctrl/Cmd+滚轮缩放，按 `data-block-id` 滚动到指定块 |
| `FlowViewer.tsx` | 连续滚动模式。IntersectionObserver 虚拟化 + 相邻页预取，上报当前可见页 |
| `PdfPageUnit.tsx` | 把一页 pdf.js 渲染到 `<canvas>`，感知 `devicePixelRatio` |
| `BlockOverlayLayer.tsx` | OCR 坐标 → PDF 坐标的缩放换算 |
| `BlockOverlay.tsx` | 单个绝对定位的 bbox 元素 |
| `PdfToolbar.tsx` | 缩放、适应宽度，以及两端的两个面板开关（左侧目录、右侧 OCR 栏） |
| `PageNav.tsx` | 首/上/「N of M」/下/末。工具栏与 OCR 栏占满时的 header 共用同一个组件 |

## 对外接口

`PdfViewer`、`FlowViewer`、`PdfPageUnit`、`BlockOverlayLayer`、`BlockOverlay`、`PdfToolbar`、`PageNav`。`blockColors.ts` 导出 `BLOCK_LABEL_COLORS`。

## 依赖方向

被 `App.tsx` 与 `src/renderer/components/sidebar/OcrSidebar.tsx`（它复用 `PageNav`）引用。依赖 `src/renderer/hooks/`（pdf.js 加载与分页缓存）、`src/renderer/api/`，以及 `src/shared` 的类型。

`PageFooter.tsx` 目前无引用（死代码），保留待 Flow 模式页脚重构时使用。

## 相关文档

- 父级：[../README.md](../README.md)
