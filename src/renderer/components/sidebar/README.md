# src/renderer/components/sidebar

## 这个目录做什么

右侧 OCR 结果栏：按块浏览或按 Markdown 浏览，支持行内编辑。

## 关键文件

| 文件 | 说明 |
|---|---|
| `OcrSidebar.tsx` | 栏体。**底部那一行**承载本栏的动作按钮（`MarkdownPane` portal 进来：阅读态是"编辑这一页"，编辑态是"取消/保存"）——它在滚动区之外，所以永远在同一个地方、永远点得到；编辑期间栏体自己让出内边距与滚动（`markdownEditing`），把整块交给编辑器。Blocks / Markdown 双视图、叠加层不透明度开关、Flow 开关、整页复制、页内统计。右上角的**占满**按钮隐藏中间的 PDF 区让本栏铺满；**只有占满时**，栏头**最左端**才出现「页码导航」与「收起」（`viewer/PageNav`）——分栏时收起由工具栏最右侧的按钮负责，占满时工具栏随 PDF 区一起消失，翻页与收起必须在这一行可达；右端始终保持复制/还原两个按钮不动 |

**占满 + 流式是这一栏自己驱动的。** 流式模式平时靠 `FlowViewer` 通过 `onVisiblePagesChange` 喂页面数据，而占满时 `FlowViewer` 连同 PDF 区一起被卸载——不额外处理就会永远停在"Scroll to load pages..."。所以这里用 `useFlowPages` 自己取页：维护一个"当前页前 1 页、后 3 页"的窗口，滚到底自动续 3 页，滚动时把最靠上的可见页通过 `onVisiblePageChange` 报回去（进度保存与目录高亮因此照常工作），工具栏/目录的跳转则由 `scrollToPage` 重新居中窗口并滚到该页。
| `SourceEditorField.tsx` | 把 `lib/sourceEditor.ts` 挂成一个 React 字段：出现即建、消失即毁，每次改动回报给父组件（父组件据此判断"保存"是否可点）。**两个编辑器共用它**，所以键位与行为只有一处。**调用方的 `className` 落在它自己那层 wrapper 上**（不是编辑器那层）：Markdown 面板给 `min-h-0 flex-1`（铺满、无边框），块卡片给 `max-h-96` 并且**必须同时给 `maxHeightPx={384}`**：卡片是"按内容长"的盒子，没有这个上限，编辑器会长到几千像素、被卡片裁掉、**哪都滚不动**（面板那条路不需要它，因为它被 `flex-1` 定死了高度）。**这条踩过坑**：把 `flex-1` 写在内层时，它对着一个"高度由内容决定"的普通块解析，于是编辑器长到整页高、被面板的 `overflow-hidden` 裁掉，**两个盒子谁都不滚**——先前的抱怨是"两条滚动条"，那次变成"一条也没有" |
| `MarkdownPane.tsx` | 这一页的 Markdown，以及"怎么改它"。**它自己没有 chrome**：按钮（编辑这一页 / 取消 / 保存 / 撤销）用 portal 送进**栏底那一行**（`actionsSlot`），编辑时 `SourceEditorField` 铺满整块并自己滚动（`onEditingChange` 让栏体在编辑期间去掉内边距与外层滚动）。阅读视图因此只有正文，编辑视图只有编辑器。**阅读视图由父组件通过 `children` 传入**，所以渲染 OCR Markdown 的 remark/rehype 插件只在一个地方配置。字段是 `markdown.text`（不是块），写路径与块相同 |
| `BlockCard.tsx` | 单块卡片：按块类型渲染 Markdown / 表格 / 图片；**翻页模式下也是编辑器**（铅笔或双击 → 原地换成 `SourceEditorField`，里面是 ocr.json 里那段**源码**——文本块按 Markdown、表格按 HTML 上色；Mod-Enter 保存 / Esc 取消 / 点别处不保存；保存后可就地撤销一次）。编辑态的卡片内边距**只留很小的纵向值**（`px-3 pt-2 pb-1`）：编辑器没有自己的框、和卡片同色，`p-3` 那种内边距看上去就是"文本框里上下各空一块" |



## 对外接口

`OcrSidebar`、`BlockCard`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/pdfs.ts`、`src/renderer/components/viewer/PageNav.tsx`、`src/shared/urls.ts`（把相对图片引用重写为 `lbook://asset/...`）、ReactMarkdown 与 rehype/remark 插件。

两个编辑器（`BlockCard` 与 `MarkdownPane`）的 chrome 各在自己文件里，状态机一样：`readField` 取当前值当 `baseValue` → 编辑 → `Ctrl+Enter` 保存 / `Esc` 取消 / 失焦不保存 → 写成功后就地显示"已写入 ocr.json"与一次"撤销这次修改"；主进程广播 `book:changed` 后由 `App` 重读，翻页与滚动位置不动。两者都按**页号**重新挂载（`key={pageNum}`），否则会出现"撤到上一页"这种错位。

编辑只在翻页模式提供：页是文件的单位，连滚模式下改一页等于在读者眼前改他正读的版面（见 `04-phase4-content-edit.md`）。改块**不会**同步改这一页的 Markdown（A18）——两份读法互相独立，编辑器标题会写明在改哪一份。

`BlockCard` 用 `dangerouslySetInnerHTML` 渲染表格块——这是生产 CSP 必须禁掉内联脚本的原因，见 `DESIGN.md` 第 11 节。

## 相关文档

- 父级：[../README.md](../README.md)
