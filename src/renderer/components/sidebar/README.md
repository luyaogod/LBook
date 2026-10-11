# src/renderer/components/sidebar

## 这个目录做什么

右侧 OCR 结果栏：按块浏览或按 Markdown 浏览，支持行内编辑。

## 关键文件

| 文件 | 说明 |
|---|---|
| `OcrSidebar.tsx` | 栏体。Blocks / Markdown 双视图、叠加层不透明度开关、Flow 开关、整页复制、页内统计。右上角的**占满**按钮隐藏中间的 PDF 区让本栏铺满；**只有占满时**，栏头**最左端**才出现「页码导航」与「收起」（`viewer/PageNav`）——分栏时收起由工具栏最右侧的按钮负责，占满时工具栏随 PDF 区一起消失，翻页与收起必须在这一行可达；右端始终保持复制/还原两个按钮不动 |

**占满 + 流式是这一栏自己驱动的。** 流式模式平时靠 `FlowViewer` 通过 `onVisiblePagesChange` 喂页面数据，而占满时 `FlowViewer` 连同 PDF 区一起被卸载——不额外处理就会永远停在"Scroll to load pages..."。所以这里用 `useFlowPages` 自己取页：维护一个"当前页前 1 页、后 3 页"的窗口，滚到底自动续 3 页，滚动时把最靠上的可见页通过 `onVisiblePageChange` 报回去（进度保存与目录高亮因此照常工作），工具栏/目录的跳转则由 `scrollToPage` 重新居中窗口并滚到该页。
| `BlockCard.tsx` | 单块卡片：按块类型渲染 Markdown / 表格 / 图片；**翻页模式下也是编辑器**（铅笔或双击 → 原地编辑框，里面是 ocr.json 里那段**源码**；Ctrl+Enter 保存 / Esc 取消 / 点别处不保存；保存后可就地撤销一次）|

## 对外接口

`OcrSidebar`、`BlockCard`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/pdfs.ts`、`src/renderer/components/viewer/PageNav.tsx`、`src/shared/urls.ts`（把相对图片引用重写为 `lbook://asset/...`）、ReactMarkdown 与 rehype/remark 插件。

编辑只在翻页模式提供：页是文件的单位，连滚模式下改一页等于在读者眼前改他正读的版面（见 `04-phase4-content-edit.md`）。改块**不会**同步改这一页的 Markdown（A18）——两份读法互相独立，编辑器标题会写明在改哪一份。

`BlockCard` 用 `dangerouslySetInnerHTML` 渲染表格块——这是生产 CSP 必须禁掉内联脚本的原因，见 `DESIGN.md` 第 11 节。

## 相关文档

- 父级：[../README.md](../README.md)
