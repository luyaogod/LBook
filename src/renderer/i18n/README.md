# src/renderer/i18n

## 这个目录做什么

界面语言。**英文是基准**（`en.ts` 是唯一的真值来源），简体中文跟随它；某条 key 只有英文时，任何语言下都显示英文——这是翻译没做完时最诚实的行为。

它**不**负责主进程自己拼出来的句子：主进程里面向用户的话应该是**英文原文**（或将来改成 code + 参数交给这里翻译，见 `.agents/plan/05-i18n.md` 的待办）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `en.ts` | 英文词典。所有 key 都在这里，`t()` 的类型也由它推导 |
| `zh-CN.ts` | 简体中文词典，类型是 `Record<TranslationKeys, string>`——**新增 key 不翻译就编译不过** |
| `index.ts` | i18next 初始化、`LOCALES`、`resolveLocale()`；两个动态 key 的出口 `languageLabel()`（语言代码是开放集合）与 `textFor()`（供应商自带文案，优先 key、回落原文） |
| `LocaleProvider.tsx` | 把设置里的语言应用到 i18next 与 `<html lang>` |
| `i18next.d.ts` | 用 `CustomTypeOptions` 把 `t()` 的 key 变成类型，写错 key 编译期就报 |

## 对外接口

`LOCALES`、`LocaleId`、`LocaleChoice`、`resolveLocale()`、`languageLabel()`、`textFor()`、`LocaleProvider`、`currentLocale()`。

## 依赖方向

被渲染层各组件与 `App.tsx` 引用。依赖 `i18next` 与 `react-i18next`（渲染层依赖，Vite 打包进 bundle）。语言**选择**存在 `config.json` 的 `locale` 字段，通过 `settings:set` 写回。

`AGENTS.md` §2 要求代码、注释、标识符用英文——词典里的中文是**数据**，不是注释，所以 `zh-CN.ts` 是这条规则的唯一例外。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../shared/README.md](../../shared/README.md)（`LocaleChoice` 定义在这里）、[../../../.agents/plan/05-i18n.md](../../../.agents/plan/05-i18n.md)
