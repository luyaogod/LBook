# src/main/translate/providers

## 这个目录做什么

一家厂商一个文件。每个文件导出一个 `TranslateProvider`：自述设置字段与支持语言，并把一段文字翻成另一种语言。

它**不**负责：选供应商、存凭据、缓存、判语种——那些都在上一层 `translate/`，这里只回答"怎么调这一家"。

## 关键文件

| 文件 | 说明 |
|---|---|
| `tencent.ts` | 腾讯云机器翻译（TMT，`TextTranslate`）。复用 `src/main/tencent/` 的签名与调用层 |

## 对外接口

`tencentTranslateProvider`。注册在 `../registry.ts` 的 `TRANSLATE_PROVIDERS` 里。

## 依赖方向

被 `../registry.ts` 引用；反过来什么都不引用（除 `../types.ts` 与 `src/main/tencent/`）。**不依赖 `electron`**。

## 加一家厂商要做什么

1. 在本目录加一个文件，导出 `TranslateProvider`：`id` / `label` / `languages` / `fields` / `translate()`；
2. 在 `../registry.ts` 的 `TRANSLATE_PROVIDERS` 里加一行。

渲染层不用改：设置表单是按 `fields` 渲染的，划词卡片只认 IPC。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../tencent/README.md](../../tencent/README.md)
