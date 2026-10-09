# src/renderer/lib

## 这个目录做什么

渲染层的通用小工具。目前只有一个。

## 关键文件

| 文件 | 说明 |
|---|---|
| `utils.ts` | `cn()`：合并 className，clsx + tailwind-merge |

## 对外接口

`cn()`。

## 依赖方向

被 `src/renderer/components/ui/` 与若干业务组件引用。依赖 `clsx` 与 `tailwind-merge`，不依赖 React。

## 相关文档

- 父级：[../README.md](../README.md)
