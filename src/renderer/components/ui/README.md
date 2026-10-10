# src/renderer/components/ui

## 这个目录做什么

shadcn/ui 风格的通用基础组件。这些是**设计系统原语**，不含任何业务语义。

## 关键文件

| 文件 | 说明 |
|---|---|
| `button.tsx` | 按钮，含 variant / size 变体（基于 cva） |
| `slider.tsx` | 滑块，基于 `@base-ui/react/slider`。**单值时要传数组**（`value={[14]}`）：包装层按数组长度决定画几个 thumb，传裸数字会回退成 `[min, max]` 而画出两个 |

## 对外接口

`Button` 及其变体类型、`Slider`。

## 依赖方向

被渲染层各处引用。依赖 `class-variance-authority`、`@base-ui/react` 与 `src/renderer/lib/utils.ts` 的 `cn()`。

新增组件的配置见仓库根目录的 `components.json`。

**`npx shadcn add <名称>` 在本仓库需要收拾一遍再提交**：文件会落在字面量目录 `@/components/ui/`（CLI 没读 `tsconfig` 的 `paths`），而且 import 写成 `from "cn"`，还会把一个 `cn` 包装进生产依赖。正确做法：把文件移到 `src/renderer/components/ui/`，import 改成 `@/lib/utils`，并确认 `package.json` / `package-lock.json` 没被改。

## 相关文档

- 父级：[../README.md](../README.md)
