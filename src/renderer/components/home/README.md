# src/renderer/components/home

## 这个目录做什么

首页：书库列表、搜索分页，以及"添加一个书文件夹"。

它**不**提供任何编辑书内容的入口。书是磁盘上一堆属于用户的文件，改内容请在自己的编辑器里改（A5）；目录（`toc.json`）同理，阅读器里的目录树只负责显示与跳转。

## 关键文件

| 文件 | 说明 |
|---|---|
| `AddBookDialog.tsx` | 添加书籍：**从文件新建**（PDF + OCR JSON + 可选封面/目录，选存放位置，确认前显示将创建的文件夹名与页数）或**打开一个已有的书文件夹** |
| `EditBookDialog.tsx` | 维护：改书名（**文件夹跟着改名**，字段下方就写明了；结果里报出新的文件夹名，搬不动时给琥珀色提示），或替换 OCR JSON / 封面 / 目录 / PDF（每个 role 先校验再拷贝） |

| `HomePage.tsx` | 列表、按标题过滤、每页 10 条分页、移除前的确认文案（写明"不会删除文件"）。订阅 `library:changed` 自动刷新 |
| `PdfFileRow.tsx` | 单行：封面、标题、大小、页数、日期；「在文件管理器中显示」「从书库移除」「打开」。文件被移走时显示 `problem` 与"需要修复"徽标，**并在原因那句旁边给一个"定位…"**——选文件夹把它指回来（A21：Obsidian 的 "open folder as vault"，只是我们先核对 uid） |

| `PdfThumbnail.tsx` | 封面缩略图，无封面时回退为图标 |

## 对外接口

`HomePage`、`PdfFileRow`、`PdfThumbnail`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/` 与 `src/shared` 类型。

两点值得写下来：

- **"添加书籍"有两条路**：从文件新建（应用校验 JSON、决定文件夹名、用户选存放位置——A17），或指向一个已有的书文件夹（散落的元数据会被移动进 `.lbook/`）。两条都不需要用户自己校验 JSON，也不需要自己想文件夹名。
- 窗口里仍然没有 `<input type="file">`：文件与目录选择器都由主进程弹，路径只从对话框流向渲染层。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../../.agents/plan/00-decisions.md`](../../../../.agents/plan/00-decisions.md)（A5 / A11 / A12）
