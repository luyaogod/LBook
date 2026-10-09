# src/renderer/components/theme

## 这个目录做什么

暗色主题的开关。调色板在 `src/renderer/index.css`（`:root` 与 `.dark` 两套 CSS 变量），这里只负责在 `<html>` 上挂/摘 `dark` 类并把用户的选择存回去。

它**不**负责：定义任何颜色（组件一律用 token，不写死色值），也不负责窗口自身的颜色（那是 `src/main/theme.ts` 的事）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `ThemeProvider.tsx` | 读写主题设置；把「显式选择」与「prefers-color-scheme」合成当前主题，在 `<html>` 上挂/摘 `dark`；同步 `color-scheme` 让原生控件（下拉、滚动条、光标）也变暗 |

## 对外接口

`ThemeProvider`、`useTheme()`（返回 `{ theme, resolved, setTheme }`）。

## 依赖方向

被 `App.tsx` 包在最外层。依赖 `window.api.settings`（读设置）与 `@shared/ipc` 的类型。**不依赖 `electron`**。

## 为什么同时看设置与媒体查询

- **显式选择（light / dark）直接生效**，不依赖媒体查询事件——点一下就是一下；
- **`system` 才去看 `prefers-color-scheme`**。这个媒体查询报的已经是**用户选的那个**主题，因为主进程把它写进了 `nativeTheme.themeSource`（见 `src/main/theme.ts`）：设置还没取回来时 `theme` 是 `system`，而媒体查询已经是对的，所以首帧不会闪浅色。
- 挂类用的是 `useLayoutEffect`（不是 `useEffect`）：必须在**首次绘制之前**把类挂上，否则暗色窗口会先用浅色调色板画一帧。更早的那一段（JS 尚未执行）由窗口自身的 `backgroundColor` 兜底。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../index.css](../../index.css)、[../../../main/theme.ts](../../../main/theme.ts)
