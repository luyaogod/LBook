# src/renderer/components/home

## 这个目录做什么

首页：书库列表、搜索分页，以及"添加一个书文件夹"。

它**不**提供任何编辑书内容的入口。书是磁盘上一堆属于用户的文件，改内容请在自己的编辑器里改（A5）；目录（`toc.json`）同理，阅读器里的目录树只负责显示与跳转。

## 关键文件

| 文件 | 说明 |
|---|---|
| `HomePage.tsx` | 列表、按标题过滤、每页 10 条分页、移除前的确认文案（写明"不会删除文件"）。订阅 `library:changed` 自动刷新 |
| `PdfFileRow.tsx` | 单行：封面、标题、大小、页数、日期；「在文件管理器中显示」「从书库移除」「打开」。文件被移走时显示 `problem` 与"需要修复"徽标 |
| `PdfThumbnail.tsx` | 封面缩略图，无封面时回退为图标 |

## 对外接口

`HomePage`、`PdfFileRow`、`PdfThumbnail`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/` 与 `src/shared` 类型。

两点值得写下来：

- **"添加书籍"是选文件夹**，不是上传文件：`openBookFolder()` 由主进程弹目录选择框、校验、必要时创建 `meta.json`、写台账。窗口里没有 `<input type="file">` 了。
- **"移除"只删台账条目**（A11）。确认对话框必须把这一点写出来，这是界面对用户的核心承诺。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[`../../../.agents/plan/00-decisions.md`](../../../../.agents/plan/00-decisions.md)（A5 / A11 / A12）
