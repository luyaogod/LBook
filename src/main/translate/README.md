# src/main/translate

## 这个目录做什么

翻译能力的**厂商无关**层：选供应商、取凭据、查缓存、判语种，最后才轮到具体厂商发请求。

它**不**知道任何具体厂商的名字（供应商通过注册表注入），也不碰 UI、不写 `.lbook`。加一家厂商 = 在 `providers/` 下加一个文件 + 在 `registry.ts` 里加一行。

## 关键文件

| 文件 | 说明 |
|---|---|
| `types.ts` | `TranslateProvider` 契约：自述字段（`fields`）、支持语言、`translate()`，以及**可选**的 `speak()`（没有语音服务的厂商直接不实现，界面自动隐藏喇叭）；`ProviderConfigError` 表示"凭据没填"这类用户可修复的问题 |
| `registry.ts` | 已知供应商清单 + `createProviderRegistry()`：按 id 取、列元数据（**只挑字段，不外发函数**）、未知 id 回退到第一家 |
| `providers/tencent.ts` | 腾讯云机器翻译（`TextTranslate`）+ 语音合成（`TextToVoice`，与翻译共用同一对密钥）。文档已移除文本翻译接口且 QPS 在逐年归零，见下方注释与 `DESIGN.md` |
| `detect.ts` | 本地语种判断（CJK 占比）。腾讯的 `LanguageDetect` 已随 TMT 文本接口一并下线，所以 `auto` 只能自己判 |
| `cache.ts` | 磁盘翻译记忆：单个 JSON 文件、按 `provider+源+目标+原文` 哈希、写入去抖、超额淘汰最旧 |
| `service.ts` | 门面：`settingsView()` / `updateSettings()` / `translate()` / `speak()`。**密钥默认只写不读**，`auto` 先本地判定，源=目标直接短路，命中缓存不花钱，朗读音频在主进程内存里留最近 64 条 |

## 对外接口

`createTranslateService()`、`TranslateService`、`TranslateSettingsPatch`；`createProviderRegistry()`、`ProviderRegistry`、`TRANSLATE_PROVIDERS`；`TranslateProvider`、`SpeakCallInput`、`ProviderConfigError`；`detectLanguage()`；`createTranslateCache()`、`translateCacheKey()`。

## 依赖方向

被 `src/main/context.ts` 装配、被 `src/main/ipc/` 暴露；`providers/tencent.ts` 复用 `src/main/tencent/`（签名与调用层）。**不依赖 `electron`**，HTTP 通过 `fetchImpl` 注入，因此整层可在纯 Node 下测试且不发真实请求。

## 几条不能凭直觉改的约定

- **`""` 与 `null` 不是一回事。** 设置页里没动过的密码框会提交空串，语义是"保持原值"；只有显式 `null` 才清除。把空串当成清除，用户改一次无关设置就会把密钥抹掉。
- **设置页需要看到密钥。** `settingsView()` 会带上已存的凭据（表单预填，密码框显示为点、小眼睛可切换明文复制）——这是刻意的取舍，见 `DESIGN.md` 8.2。**但只有 `settings:get` 带凭据**：翻译、朗读、划词卡片一律拿不到，密钥也不进日志与错误信息。
- **表单预填之后，空值就是"删除"。** `""` 与 `null` 都表示移除该字段；键不存在才表示"不动它"。
- **朗读音频只在内存里缓存，不落盘。** 它是可再生的，落盘只会多一种"损坏后没声音"的故障。默认音色由接口决定，等设置页加音色选择再传 `VoiceType`。
- **源语言 = 目标语言时不要调接口。** 中文页面里划中文，调一次就是白花钱。
- **缓存键包含供应商。** 换供应商重译同一段文本应当重新调用，而不是命中别家的结果。
- **翻译缓存在 `%APPDATA%\LBook\cache\` 下**，删掉只损失一次重新翻译的费用，绝不丢用户数据。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md)、[../tencent/README.md](../tencent/README.md)
