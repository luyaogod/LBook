import { callTencentApi } from "../../tencent/client"
import { isWithinTtsLimit, textToVoice, TTS_MAX_CJK_CHARS, TTS_MAX_LATIN_LETTERS } from "../../tencent/tts"
import { ProviderConfigError, type TranslateProvider } from "../types"

/**
 * Tencent Cloud machine translation (TMT)— `tmt.tencentcloudapi.com`, action `TextTranslate`.
 * https://cloud.tencent.com/document/product/551/17231 (the interface list)
 *
 * Note: TextTranslate was removed from the documentation in the 2026-07-08 release;
 * the announcement cuts its QPS month by month from 2026-10-01 and **to zero on
 * 2027-10-01**, and the replacement (LLM-backed translation) is not published yet.
 * It still answers today (verified), so it stays — DESIGN.md 8.4 keeps the timeline
 * and the rule that this layer must be swappable at short notice.
 */

const TMT_VERSION = "2018-03-21"
const DEFAULT_REGION = "ap-guangzhou"

export const tencentTranslateProvider: TranslateProvider = {
  id: "tencent",
  label: "Tencent Cloud",
  labelKey: "provider.tencent.label",
  languages: ["zh", "en"],
  fields: [
    {
      key: "secretId",
      label: "SecretId",
      placeholder: "AKID...",
      hint: "Access Management → API Keys. A sub-account key limited to translation is best.",
    },
    { key: "secretKey", label: "SecretKey", secret: true, hint: "Shown once at creation; save it immediately.", hintKey: "provider.tencent.secretKey.hint" },
    { key: "region", label: "Region", labelKey: "provider.tencent.region", placeholder: DEFAULT_REGION },
  ],

  async translate(input, credentials, fetchImpl) {
    const secretId = credentials.secretId?.trim()
    const secretKey = credentials.secretKey?.trim()
    if (!secretId || !secretKey) {
      throw new ProviderConfigError("Tencent Cloud needs a SecretId and SecretKey; fill them in under Settings.")
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
      throw new Error(`TextTranslate returned no translation (RequestId ${requestId ?? "unknown"})`)
    }
    return {
      text: data.TargetText,
      source: data.Source ?? input.source,
      target: data.Target ?? input.target,
    }
  },

  /**
   * Text-to-speech uses the same credential pair (same Tencent Cloud account), so
   * reading aloud needs no extra configuration. The voice stays at the API default
   * until the settings page can pick one and pass a VoiceType down.
   */
  async speak(input, credentials, fetchImpl) {
    const secretId = credentials.secretId?.trim()
    const secretKey = credentials.secretKey?.trim()
    if (!secretId || !secretKey) {
      throw new ProviderConfigError("Reading aloud needs a SecretId and SecretKey; fill them in under Settings.")
    }

    // 1 = Chinese, 2 = English; the API bills and voices each language separately.
    const primaryLanguage = input.language === "zh" ? 1 : 2
    const text = input.text.trim()
    if (text.length === 0) throw new Error("There is no text to read aloud")

    // The API refuses over-long text instead of truncating, and its own limit is
    // per language; say so here rather than letting a vendor code reach the card.
    if (!isWithinTtsLimit(text, primaryLanguage)) {
      const limit =
        primaryLanguage === 1 ? `${TTS_MAX_CJK_CHARS} Chinese characters` : `${TTS_MAX_LATIN_LETTERS} letters`
      throw new Error(`This selection is ${text.length} characters, over the ${limit} limit for one request; shorten it.`)
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
