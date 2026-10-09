import { randomUUID } from "node:crypto"
import { callTencentApi } from "./client"
import type { TencentCredentials } from "./sign"

/**
 * 语音合成 (TTS) — `tts.tencentcloudapi.com`, action `TextToVoice`.
 * https://cloud.tencent.com/document/product/1073/37995
 */

export const TTS_SERVICE = "tts"
export const TTS_ACTION = "TextToVoice"
export const TTS_VERSION = "2019-08-23"
/** The API is regional but does not require a region; Guangzhou is the default. */
export const TTS_DEFAULT_REGION = "ap-guangzhou"

/**
 * Per-request text limits, in the units the API counts (UTF-8 characters):
 * full-width punctuation counts as a Chinese character, half-width as a letter.
 * Anything longer has to be split — see `assertTextFits`.
 */
export const TTS_MAX_CJK_CHARS = 150
export const TTS_MAX_LATIN_LETTERS = 500

export interface TextToVoiceInput {
  text: string
  /** 音色 ID; the catalogue is per-account, see 音色列表 in the docs. */
  voiceType?: number
  /** 1 = Chinese (default), 2 = English. */
  primaryLanguage?: number
  /** [-2, 6]: -2 is 0.6x, 0 is 1.0x, 6 is 2.5x. */
  speed?: number
  /** [-10, 10], 0 is normal. */
  volume?: number
  /** 24000 / 16000 (default) / 8000. Not every voice supports 24k. */
  sampleRate?: number
  codec?: "wav" | "mp3" | "pcm"
  /** Time-stamped subtitle units; unsupported by some voices. */
  enableSubtitle?: boolean
  /** Echoed back by the API; generated when omitted. */
  sessionId?: string
  region?: string
}

export interface Subtitle {
  Text: string
  BeginTime: number
  EndTime: number
  BeginIndex: number
  EndIndex: number
  Phoneme?: string
}

export interface TextToVoiceResult {
  /** Decoded audio, ready to write to a file or hand to the renderer. */
  audio: Buffer
  codec: string
  requestId: string | null
  sessionId: string
  subtitles: Subtitle[]
}

/** Chinese text is counted in characters, Latin text in letters. */
export function isWithinTtsLimit(text: string, primaryLanguage = 1): boolean {
  return primaryLanguage === 2 ? text.length <= TTS_MAX_LATIN_LETTERS : text.length <= TTS_MAX_CJK_CHARS
}

export function assertTextFits(text: string, primaryLanguage = 1): void {
  if (text.trim() === "") throw new Error("TTS text is empty")
  if (!isWithinTtsLimit(text, primaryLanguage)) {
    const limit = primaryLanguage === 2 ? `${TTS_MAX_LATIN_LETTERS} letters` : `${TTS_MAX_CJK_CHARS} characters`
    throw new Error(`TTS text is ${text.length} long, over the ${limit} per-request limit; split it first`)
  }
}

/**
 * The TTS error codes that need an action rather than a code fix.
 *
 * Verified against a real account: a valid key on an account whose free quota is
 * spent answers `UnsupportedOperation.PkgExhausted`, which reads like a bug until
 * you know it is a billing state. Billing order is 免费资源包 → 预付费资源包 →
 * 后付费, and when the free pack runs out the product **stops serving** unless
 * pay-as-you-go has been switched on in the console.
 */
const TTS_ERROR_HINTS: Record<string, string> = {
  "UnsupportedOperation.PkgExhausted":
    "语音合成资源包已用尽。控制台领取免费资源包（基础/精品音色 800 万字符，3 个月有效、每账号一次），或开通后付费/购买资源包。",
  "UnsupportedOperation.NoFreeAccount":
    "免费资源包已用尽且未开通后付费。控制台领取或开通后付费。",
  "UnsupportedOperation.AccountArrears": "账号欠费，语音合成已停服。",
  "InvalidParameterValue.AppIdNotRegistered":
    "该账号未开通语音合成服务。去 https://console.cloud.tencent.com/tts 点开通。",
  "InvalidParameterValue.VoiceType": "音色 ID 不在该账号可用的音色列表里。",
  "InvalidParameterValue.Text": `文本不合法或超出单次上限（中文 ${TTS_MAX_CJK_CHARS} 字、英文 ${TTS_MAX_LATIN_LETTERS} 字母）。`,
  "UnsupportedOperation.TextTooLong": "文本过长，需要分段。",
  "LimitExceeded.AccessLimit": "超过并发/频率限制，需要退避重试。",
}

/** A human action for a TTS error code, or null when the code is not a known one. */
export function explainTtsError(code: string): string | null {
  return TTS_ERROR_HINTS[code] ?? null
}

export async function textToVoice(
  credentials: TencentCredentials,
  input: TextToVoiceInput,
  fetchImpl?: typeof fetch,
): Promise<TextToVoiceResult> {
  const codec = input.codec ?? "wav"
  const primaryLanguage = input.primaryLanguage ?? 1
  assertTextFits(input.text, primaryLanguage)

  const sessionId = input.sessionId ?? randomUUID()
  const payload: Record<string, unknown> = {
    Text: input.text,
    SessionId: sessionId,
    Codec: codec,
    PrimaryLanguage: primaryLanguage,
  }
  if (input.voiceType !== undefined) payload.VoiceType = input.voiceType
  if (input.speed !== undefined) payload.Speed = input.speed
  if (input.volume !== undefined) payload.Volume = input.volume
  if (input.sampleRate !== undefined) payload.SampleRate = input.sampleRate
  if (input.enableSubtitle !== undefined) payload.EnableSubtitle = input.enableSubtitle

  const { data, requestId } = await callTencentApi<{ Audio?: string; SessionId?: string; Subtitles?: Subtitle[] }>({
    service: TTS_SERVICE,
    action: TTS_ACTION,
    version: TTS_VERSION,
    region: input.region ?? TTS_DEFAULT_REGION,
    payload,
    credentials,
    fetchImpl,
  })

  if (!data.Audio) throw new Error(`TextToVoice returned no audio (RequestId ${requestId ?? "unknown"})`)

  return {
    audio: Buffer.from(data.Audio, "base64"),
    codec,
    requestId,
    sessionId: data.SessionId ?? sessionId,
    subtitles: data.Subtitles ?? [],
  }
}
