import { callTencentApi } from "../../tencent/client"
import { isWithinTtsLimit, textToVoice, TTS_MAX_CJK_CHARS, TTS_MAX_LATIN_LETTERS } from "../../tencent/tts"
import { ProviderConfigError, type TranslateProvider } from "../types"

/**
 * 腾讯云机器翻译（TMT）— `tmt.tencentcloudapi.com`, action `TextTranslate`.
 * https://cloud.tencent.com/document/product/551/17231 (the interface list)
 *
 * 注意：TextTranslate 已在 2026-07-08 的发布里从文档移除，官方公告说相关接口的 QPS
 * 从 2026-10-01 起逐月缩减、**2027-10-01 归零**，替代品"大模型文本翻译"尚未上架。
 * 它目前仍可调用（实测通过），所以先用着；`DESIGN.md` 记了这条时间线和"随时准备换供应商"。
 */

const TMT_VERSION = "2018-03-21"
const DEFAULT_REGION = "ap-guangzhou"

export const tencentTranslateProvider: TranslateProvider = {
  id: "tencent",
  label: "腾讯云机器翻译",
  languages: ["zh", "en"],
  fields: [
    {
      key: "secretId",
      label: "SecretId",
      placeholder: "AKID...",
      hint: "访问管理 → API 密钥管理。建议用只授了翻译权限的子账号密钥。",
    },
    { key: "secretKey", label: "SecretKey", secret: true, hint: "仅创建时可见，创建后请立刻保存。" },
    { key: "region", label: "地域", placeholder: DEFAULT_REGION },
  ],

  async translate(input, credentials, fetchImpl) {
    const secretId = credentials.secretId?.trim()
    const secretKey = credentials.secretKey?.trim()
    if (!secretId || !secretKey) {
      throw new ProviderConfigError("腾讯云机器翻译缺少 SecretId / SecretKey，请先在设置里填写。")
    }

    const { data, requestId } = await callTencentApi<{ TargetText?: string; Source?: string; Target?: string }>({
      service: "tmt",
      action: "TextTranslate",
      version: TMT_VERSION,
      region: credentials.region?.trim() || DEFAULT_REGION,
      credentials: { secretId, secretKey },
      payload: { SourceText: input.text, Source: input.source, Target: input.target, ProjectId: 0 },
      fetchImpl,
    })

    if (typeof data.TargetText !== "string") {
      throw new Error(`TextTranslate 没有返回译文（RequestId ${requestId ?? "unknown"}）`)
    }
    return {
      text: data.TargetText,
      source: data.Source ?? input.source,
      target: data.Target ?? input.target,
    }
  },

  /**
   * 语音合成走的是同一对密钥（同一个腾讯云账号），所以朗读不需要额外配置。
   * 音色暂用接口默认值：等设置页加上音色选择，再把 VoiceType 传下来。
   */
  async speak(input, credentials, fetchImpl) {
    const secretId = credentials.secretId?.trim()
    const secretKey = credentials.secretKey?.trim()
    if (!secretId || !secretKey) {
      throw new ProviderConfigError("语音合成缺少 SecretId / SecretKey，请先在设置里填写。")
    }

    // 1 = 中文，2 = 英文；接口按语言使用不同的音色与计费档位。
    const primaryLanguage = input.language === "zh" ? 1 : 2
    const text = input.text.trim()
    if (text.length === 0) throw new Error("没有可朗读的文本")

    // The API refuses over-long text instead of truncating, and its own limit is
    // per language; say so here rather than letting a vendor code reach the card.
    if (!isWithinTtsLimit(text, primaryLanguage)) {
      const limit =
        primaryLanguage === 1 ? `${TTS_MAX_CJK_CHARS} 个汉字` : `${TTS_MAX_LATIN_LETTERS} 个字母`
      throw new Error(`这段文字有 ${text.length} 个字符，超过单次朗读上限（${limit}），请缩短选区。`)
    }

    const { audio } = await textToVoice(
      { secretId, secretKey },
      {
        text,
        primaryLanguage,
        codec: "mp3",
        sampleRate: 16000,
        speed: 0,
        volume: 0,
        region: credentials.region?.trim() || undefined,
      },
      fetchImpl,
    )

    return { audio, mime: "audio/mpeg" }
  },
}
