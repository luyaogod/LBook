# src/renderer/lib

## 这个目录做什么

渲染层的通用小工具。目前两个。

## 关键文件

| 文件 | 说明 |
|---|---|
| `utils.ts` | `cn()`：合并 className，clsx + tailwind-merge |
| `editHistory.ts` | 会话内的勘误历史：**每条只记差异**（`before`/`after`），按 `uid` 分书，上限 50。**刻意不引 React 与 IPC**，这样能在 node 环境直接测（`tests/unit/renderer/editHistory.test.ts`）。两条容易写错的地方写在注释里：快照未变时必须保持同一引用（`useSyncExternalStore` 按引用比较），变了必须换新数组（否则 React 看不见） |
| `sourceEditor.ts` | 源码编辑器：CodeMirror 6 的**按需加载**与唯一一处配置（要哪几个扩展、主题、`Mod-Enter`/`Esc` 键位）。**不引 `basicSetup`**：自动补全/折叠/lint 对 3–13KB 的字段是噪音。不引 worker、不用 `new Function`，所以没有 `app://` 与 CSP 那两道路障（Monaco 有，见 A19 修订）。对外只暴露 `createSourceEditor()` 与一个 `SourceEditorHandle`，CM6 的类型不外漏 |
| `writeError.ts` | 把写失败变成读者能读的一句话：我们自己的消息带着翻译 key（`WriteOutcome.code`）就翻译，厂商/文件系统的原话就原样显示（I6）。**这条规则只在这里写一次**，三个编辑器都用它 |
| `readingFont.ts` | `applyReadingFontSize(px)`：把阅读字号写到 `<html>` 的 `--reading-font-size`。**只有这里知道这个变量名**，写入方有两处（`App` 落盘值 / 设置滑块拖动中预览） |

## 对外接口

`cn()`、`applyReadingFontSize()`、`createSourceEditor()`、`recordEdit()`/`editsOf()`/`newestEdit()`/`forgetEdit()`/`snippetOf()`（历史）、`writeErrorText()`。

## 依赖方向

被 `src/renderer/components/ui/` 与若干业务组件引用。依赖 `clsx` 与 `tailwind-merge`；`readingFont.ts` 直接摸 `document`，所以只能在渲染层用（它本来也在渲染层）。

## 相关文档

- 父级：[../README.md](../README.md)
