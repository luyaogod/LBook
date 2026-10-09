# src/renderer/components/home

## 这个目录做什么

首页：书目列表、搜索分页，以及导入与编辑两个对话框。

这里也是**目录（`toc.json`）唯一的增删改入口**——建书时一并附上、编辑时替换或移除。阅读器里的目录树只负责显示与跳转。

## 关键文件

| 文件 | 说明 |
|---|---|
| `HomePage.tsx` | 列表、按标题过滤、每页 10 条分页。订阅 `library:changed` 自动刷新 |
| `PdfFileRow.tsx` | 单行：封面、标题、大小、页数、日期、未保存徽标、编辑与打开 |
| `PdfThumbnail.tsx` | 封面缩略图，无封面时回退为图标 |
| `UploadDialog.tsx` | 选 PDF + PaddleOCR JSON + 可选封面 + 可选 `toc.json`，调用 `createFromFiles()` |
| `EditDialog.tsx` | 替换 OCR JSON、封面与 `toc.json`；已有目录时可勾选移除 |

## 对外接口

`HomePage`、`PdfFileRow`、`PdfThumbnail`、`UploadDialog`、`EditDialog`。

## 依赖方向

被 `App.tsx` 引用。依赖 `src/renderer/api/` 与 `src/shared` 类型。

两个对话框用 `<input type="file">` 保持原生选择体验，再经 `window.api.files.getPath()` 把 `File` 转成绝对路径交给主进程——**文件字节不跨越 IPC 边界**。

## 相关文档

- 父级：[../README.md](../README.md)
