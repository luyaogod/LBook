# src/renderer/components/settings

## 这个目录做什么

设置面板：一个浮层，左边目录、右边内容。目录是 **General**（外观 + 语言）、**Font**（阅读区字号，只有一个滑块）与 **Translate**（翻译供应商与凭据）。**每次打开都停在 General**——面板是反复回来改同样几件事的地方，让"默认页"跟着上次停留走，它就变成历史记录而不是默认值了。

它**不**负责：持久化（走 `settings:*` IPC，配置由主进程写 `config.json`），也不认识任何云厂商。

Font 排在 Translate 前面：它是**读的时候**想改的，而不是配一次就不再碰的。

## 关键文件

| 文件 | 说明 |
|---|---|
| `SettingsDialog.tsx` | 浮层骨架：左侧分区列表、右侧内容、Esc/点背景关闭、左下角版本号 |
| `GeneralSettings.tsx` | General 分区：Appearance 与 Language 各三张卡片 |
| `FontSettings.tsx` | Font 分区：只有一个字号滑块（+ 数值与恢复默认）。**拖动时不走 IPC**，松手才落盘，理由写在文件头 |
| `TranslateSettings.tsx` | 翻译分区：选供应商、填凭据、选语言、保存、"测试翻译" |

## 对外接口

`SettingsDialog`、`GeneralSettings`、`FontSettings`、`TranslateSettings`。

## 依赖方向

被 `App.tsx` 引用（两栏顶栏的 Bolt 按钮与译文卡片的"去设置"都打开它）。依赖 `window.api.settings`、`@/api/translate`、`@shared/translate` 的类型，以及 `@/lib/readingFont`（字号如何落到 CSS 上）。

**表单字段是按供应商自述渲染的**：`providers[].fields` 决定有几个输入框、哪些是密码框、提示写什么。新增一家厂商不需要动这里的任何一行——这是"翻译模块可替换"在 UI 侧的落点。

密钥**预填已存的值**：密码框默认显示为点，点小眼睛切换明文，明文状态下可以选中复制。只有 `settings:get` 这一个载荷会带上凭据（划词卡片、翻译/朗读通道都拿不到），密钥也不进日志。**清空输入框并保存 = 移除该密钥**——表单既然是预填的，空值就只能是"要删掉"，这一点在字段的 placeholder 上写明了。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../main/translate/README.md](../../../main/translate/README.md)
