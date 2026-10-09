# src/main/tencent

## 这个目录做什么

腾讯云 API 3.0 的调用层：签名、发请求、把错误解包成能看懂的一句话。

目前只服务两个接口——**语音合成**（`tts` / `TextToVoice`）与**机器翻译**（`tmt` / `TextTranslate`）。产品之间只有 action、version 和 payload 不同，信封是一样的，所以只有一条调用路径。

它**不**负责：密钥存到哪（那是 `config/` 与设置页的事）、结果接到界面或写进 `.lbook`（那是功能层的事），也不负责断句与分段（接口有长度上限，见下）。

## 关键文件

| 文件 | 说明 |
|---|---|
| `sign.ts` | `TC3-HMAC-SHA256` 签名：规范请求串 → 待签名字符串 → 派生密钥 → Authorization。纯函数，时间戳可注入 |
| `client.ts` | `callTencentApi()`：签名 + POST JSON + 解包 `Response.Error`，抛 `TencentApiFailure`（带 Code 与 RequestId） |
| `tts.ts` | `textToVoice()`：音色/语速/采样率/编码等入参，返回解码后的音频 Buffer 与 RequestId；`assertTextFits()` 拦超长文本 |

## 对外接口

`signTencentRequest()`、`sha256Hex()`、`utcDateOf()`、`TencentCredentials`、`TencentApiRequest`；`callTencentApi()`、`TencentApiFailure`；`textToVoice()`、`assertTextFits()`、`isWithinTtsLimit()`、`TTS_MAX_CJK_CHARS`、`TTS_MAX_LATIN_LETTERS`、`TTS_DEFAULT_REGION`。

## 依赖方向

被 `scripts/tencent-probe.ts` 引用，后续被功能层与 IPC 引用。只依赖 `node:crypto` 与全局 `fetch`，**不依赖 `electron`**，因此可以在纯 Node 下单元测试。

## 几条不能凭直觉改的约定

- **不用官方 SDK。** `tencentcloud-sdk-nodejs` 为两个接口引入几十 MB 生成代码，而本应用是离线安装包。算法固定且短，`tests/unit/tencent/sign.test.ts` 用官方文档算例钉住。
- **日期取 UTC。** `Date` 必须由 `X-TC-Timestamp` 换算成 **UTC+0** 的日期；写成东八区日期时，白天调用正常、凌晨必然签名失败。
- **签名的 body 与实际发出的 body 必须是同一串字节。** `signTencentRequest()` 返回的 `body` 就是被哈希的那一份，调用方不得重新序列化。
- **`X-TC-Region` 不参与签名**（签名头固定为 `content-type;host;x-tc-action`），但发出去的值仍必须真实。
- **一次请求的文本有上限**：中文 150 字 / 英文 500 字母。超长要分段，不要指望服务端截断。

## 相关文档

- 父级：[../README.md](../README.md)
- 相关：[../../../DESIGN.md](../../../DESIGN.md)、[../../../BUILD.md](../../../BUILD.md)
