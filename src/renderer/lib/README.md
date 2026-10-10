# src/renderer/lib

## 这个目录做什么

渲染层的通用小工具。目前两个。

## 关键文件

| 文件 | 说明 |
|---|---|
| `utils.ts` | `cn()`：合并 className，clsx + tailwind-merge |
| `readingFont.ts` | `applyReadingFontSize(px)`：把阅读字号写到 `<html>` 的 `--reading-font-size`。**只有这里知道这个变量名**，写入方有两处（`App` 落盘值 / 设置滑块拖动中预览） |

## 对外接口

`cn()`、`applyReadingFontSize()`。

## 依赖方向

被 `src/renderer/components/ui/` 与若干业务组件引用。依赖 `clsx` 与 `tailwind-merge`；`readingFont.ts` 直接摸 `document`，所以只能在渲染层用（它本来也在渲染层）。

## 相关文档

- 父级：[../README.md](../README.md)
