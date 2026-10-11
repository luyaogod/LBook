# src/renderer/components/sidebar

## 这个目录做什么

右侧 OCR 结果栏：按块浏览或按 Markdown 浏览，支持行内编辑。

## 关键文件

| 文件 | 说明 |
|---|---|
| `OcrSidebar.tsx` | 栏体。Blocks / Markdown 双视图、叠加层不透明度开关、Flow 开关、整页复制、页内统计。右上角的**占满**按钮隐藏中间的 PDF 区让本栏铺满；**只有占满时**，栏头**最左端**才出现「页码导航」与「收起」（`viewer/PageNav`）——分栏时收起由工具栏最右侧的按钮负责，占满时工具栏随 PDF 区一起消失，翻页与收起必须在这一行可达；右端始终保持复制/还原两个按钮不动 |

**占满 + 流式是这一栏自己驱动的。** 流式模式平时靠 `FlowViewer` 通过 `onVisiblePagesChange` 喂页面数据，而占满时 `FlowViewer` 连同 PDF 区一起被卸载——不额外处理就会永远停在"Scroll to load pages..."。所以这里用 `useFlowPages` 自己取页：维护一个"当前页前 1 页、后 3 页"的窗口，滚到底自动续 3 页，滚动时把最靠上的可见页通过 `onVisiblePageChange` 报回去（进度保存与目录高亮因此照常工作），工具栏/目录的跳转则由 `scrollToPage` 重新居中窗口并滚到该页。
| `SourceEditorField.tsx` | 把 `lib/sourceEditor.ts` 挂成一个 React 字段：出现即建、消失即毁，每次改动回报给父组件（父组件据此判断"保存"是否可点）。**两个编辑器共用它**，所以键位与行为只有一处 |
| `MarkdownPane.tsx` | 这一页的 Markdown，以及"怎么改它"：Markdown 视图右上角的"编辑这一页的 Markdown"与 `SourceEditorField`（CodeMirror，按 Markdown 上色）都在这里。**阅读视图由父组件通过 `children` 传入**，所以渲染 OCR Markdown 的 remark/rehype 插件只在一个地方配置。字段是 `markdown.text`（不是块），写路径与块相同 |
| `BlockCard.tsx` | 单块卡片：按块类型渲染 Markdown / 表格 / 图片；**翻页模式下也是编辑器**（铅笔或双击 → 原地换成 `SourceEditorField`，里面是 ocr.json 里那段**源码**——文本块按 Markdown、表格按 HTML 上色；Mod-Enter 保存 / Esc 取消 / 点别处不保存；保存后可就地撤销一次）|


## 对外接口

`OcrSidebar`、`BlockCard`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/pdfs.ts`、`src/renderer/components/viewer/PageNav.tsx`、`src/shared/urls.ts`（把相对图片引用重写为 `lbook://asset/...`）、ReactMarkdown 与 rehype/remark 插件。

两个编辑器（`BlockCard` 与 `MarkdownPane`）的 chrome 各在自己文件里，状态机一样：`readField` 取当前值当 `baseValue` → 编辑 → `Ctrl+Enter` 保存 / `Esc` 取消 / 失焦不保存 → 写成功后就地显示"已写入 ocr.json"与一次"撤销这次修改"；主进程广播 `book:changed` 后由 `App` 重读，翻页与滚动位置不动。两者都按**页号**重新挂载（`key={pageNum}`），否则会出现"撤到上一页"这种错位。

编辑只在翻页模式提供：页是文件的单位，连滚模式下改一页等于在读者眼前改他正读的版面（见 `04-phase4-content-edit.md`）。改块**不会**同步改这一页的 Markdown（A18）——两份读法互相独立，编辑器标题会写明在改哪一份。

`BlockCard` 用 `dangerouslySetInnerHTML` 渲染表格块——这是生产 CSP 必须禁掉内联脚本的原因，见 `DESIGN.md` 第 11 节。

## 相关文档

- 父级：[../README.md](../README.md)
