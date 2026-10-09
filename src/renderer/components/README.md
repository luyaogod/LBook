# src/renderer/components

## 这个目录做什么

全部 UI 组件，按界面区域分组。组件是纯展示 + 局部交互，状态与副作用在 `App.tsx` 与 hooks 里。

## 关键文件

| 文件 | 说明 |
|---|---|
| `layout/AppHeader.tsx` | 顶栏：面包屑、保存按钮、上传入口 |
| `layout/UpdateBanner.tsx` | 新版本就绪时的非模态提示条 |
| `home/HomePage.tsx` | 首页列表、搜索、分页 |
| `home/PdfFileRow.tsx` / `PdfThumbnail.tsx` | 书目行与封面缩略图 |
| `home/UploadDialog.tsx` / `EditDialog.tsx` | 从 PDF+JSON 建书 / 替换 OCR 与封面 |
| `viewer/PdfViewer.tsx` | 单页模式 |
| `viewer/FlowViewer.tsx` | 连续滚动模式，IntersectionObserver 虚拟化 + 预取 |
| `viewer/PdfPageUnit.tsx` | 单页 canvas 渲染（感知 DPR） |
| `viewer/BlockOverlay*.tsx` | OCR 块叠加层与坐标换算 |
| `viewer/PdfToolbar.tsx` | 缩放、适应宽度，以及两端的面板开关 |
| `viewer/PageNav.tsx` | 翻页控件（工具栏与占满时的 OCR 栏 header 共用） |
| `toc/TocPanel.tsx` | 左侧目录树：展开/折叠、当前条目高亮、导入/移除 toc.json |
| `sidebar/OcrSidebar.tsx` | 右侧栏：Blocks / Markdown 双视图；Markdown 视图挂了划词翻译 |
| `settings/SettingsDialog.tsx` | 设置浮层：General / Translate 两个分区 |
| `settings/GeneralSettings.tsx` | General 分区：Appearance 三选一（Light / Dark / System） |
| `theme/ThemeProvider.tsx` | 在 `<html>` 上挂/摘 `dark`，并把选择写回设置 |
| `translate/SelectionPopup.tsx` | 划词翻译卡片（Google 插件风格） |
| `sidebar/BlockCard.tsx` | 单块卡片，支持行内编辑 |
| `ui/button.tsx` | shadcn 风格按钮 |

## 对外接口

各组件具名导出。无跨目录共享的工具导出。

## 依赖方向

被 `App.tsx` 与同层组件引用。依赖 `src/renderer/api/`、`src/renderer/hooks/`、`src/shared/urls.ts`、React 与 `lucide-react`。

`BlockCard` 用 `rehype-raw` 与 `dangerouslySetInnerHTML` 渲染 OCR 内容——这是生产 CSP 必须禁掉内联脚本的原因，见 `DESIGN.md` 第 11 节。

**颜色一律用 token，不写死色值**：调色板在 `src/renderer/index.css`（`:root` 与 `.dark` 两套变量），组件只引用 `bg-card` / `text-muted-foreground` 这类语义类。少数必须写死的例外都要配 `dark:` 变体（例如划词图标用的是 Google 自己的浅/深两套色），否则暗色下会出现刺眼的亮块。

## 相关文档

- 父级：[../README.md](../README.md)
- 子目录：[settings/README.md](./settings/README.md)、[theme/README.md](./theme/README.md)、[translate/README.md](./translate/README.md)
