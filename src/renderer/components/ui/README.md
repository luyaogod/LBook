# src/renderer/components/ui

## 这个目录做什么

shadcn/ui 风格的通用基础组件。这些是**设计系统原语**，不含任何业务语义。

## 关键文件

| 文件 | 说明 |
|---|---|
| `button.tsx` | 按钮，含 variant / size 变体（基于 cva） |

## 对外接口

`Button` 及其变体类型。

## 依赖方向

被渲染层各处引用。依赖 `class-variance-authority`、`@base-ui/react` 与 `src/renderer/lib/utils.ts` 的 `cn()`。

新增组件的配置见仓库根目录的 `components.json`。

## 相关文档

- 父级：[../README.md](../README.md)
