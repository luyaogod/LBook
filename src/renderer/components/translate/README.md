# src/renderer/components/translate

## 这个目录做什么

阅读时的翻译交互：在 Markdown 视图里划词，译文就地浮出。

交互与定位的**行为**移植自 Google 翻译扩展（闭源，但 CRX 在本机是解包状态，可直接读编译后的源码）。移植的是规则与常量，代码是自己写的——见下方"不能凭直觉改的约定"。

它**不**负责：调用厂商（走 `translate:text` / `translate:speak` IPC），也不管凭据与语言设置（在设置面板里）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `SelectionPopup.tsx` | 划词两步走：选中先出**小图标**（不请求），点图标才翻译并展开卡片；卡片可朗读原文与译文 |

## 对外接口

`SelectionPopup`。

## 依赖方向

被 `src/renderer/components/sidebar/OcrSidebar.tsx` 挂在 Markdown 视图的滚动容器上。依赖 `@/api/translate`。

## 几条不能凭直觉改的约定

- **选中不翻译，点击才翻译。** 选中往往只是为了复制或划线；自动翻译既打断阅读也要花钱。
- **图标位置照抄 Google 翻译扩展**（`Bubble.getTranslateIcon`，取自本机已安装扩展的解包源码 `…/Extensions/aapbdbdomjkkjkaonfhkkikfgjllcleb/2.0.17_0/bubble_compiled.js`）：
  - 水平 `clientX - 13`——图标 25px 宽，即**以鼠标松开点为中心**（本项目图标 24px，取 `clientX - 12`）；
  - 垂直：鼠标在选区**下半** → `rect.bottom + 1`（放选区下方）；**上半** → `rect.top - 1 - 27`（放选区上方）。
  - 这两条合起来的效果是：**图标永远落在选区矩形之外**，不会压住选区后面的文字。这是它和"紧贴选区末尾"的关键差别，别改回后者。
- **三条静默抑制规则**（规则照抄 `Bubble.bubbleCheck`，**阈值不抄**）：文本 > **500** 字符不出图标（不是弹错误，Google 的原值是 250，本项目刻意抬高到一段话的量级，同时仍远低于腾讯 TMT 单次请求的 2000 字符上限）；纯数字与标点（页码、表格数字）不出图标；窗口宽 ≤ **400px** 不出图标。另外 `goodAnchor()` 会丢弃 `top==0 && left==0` 的矩形（隐藏或量不出来的选区）。
- **卡片跟着图标往外长**：图标在选区上方则卡片在图标上方，反之亦然；只有那一侧放不下时才跨到选区另一侧。这样卡片也不会压住选区。
- **只在 Markdown 视图下生效。** 块视图里选中的是分块文本，不是"读一段话"的场景；`enabled=false` 时监听器整体不挂。
- **滚动即关闭。** 选区矩形是视口坐标，容器一滚就失效，继续显示会指到错误的位置。
- **卡片与图标内的 `mousedown` 都要 `preventDefault`。** 否则点一下就把选区清掉，用户看到高亮消失。
- **音频按「语言 + 文本」缓存在内存里**（`URL.createObjectURL`），重复点喇叭不再合成、不再计费；组件卸载时统一 `revokeObjectURL`。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../main/translate/README.md](../../../main/translate/README.md)
