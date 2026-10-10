import { randomUUID } from "node:crypto"
import { callTencentApi } from "./client"
import type { TencentCredentials } from "./sign"

/**
 * Text-to-speech (TTS) — `tts.tencentcloudapi.com`, action `TextToVoice`.
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
  /** Voice ID; the catalogue is per-account, see the voice list in the docs. */
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
 * you know it is a billing state. Billing runs free pack -> prepaid pack -> pay as you
 * go, and when the free pack is spent the product **stops serving** unless
 * pay-as-you-go has been switched on in the console.
 */
const TTS_ERROR_HINTS: Record<string, string> = {
  "UnsupportedOperation.PkgExhausted":
    "The text-to-speech quota is spent. Claim the free pack in the console (8M characters, valid 3 months, once per account) or enable pay-as-you-go / buy a pack.",
  "UnsupportedOperation.NoFreeAccount":
    "The free pack is spent and pay-as-you-go is off. Claim or enable one in the console.",
  "UnsupportedOperation.AccountArrears": "The account is in arrears, so text-to-speech is suspended.",
  "InvalidParameterValue.AppIdNotRegistered":
    "Text-to-speech is not enabled for this account. Enable it at https://console.cloud.tencent.com/tts.",
  "InvalidParameterValue.VoiceType": "That voice ID is not available to this account.",
  "InvalidParameterValue.Text": `The text is invalid or over one request's limit (${TTS_MAX_CJK_CHARS} Chinese characters, ${TTS_MAX_LATIN_LETTERS} letters).`,
  "UnsupportedOperation.TextTooLong": "The text is too long and has to be split.",
  "LimitExceeded.AccessLimit": "Rate or concurrency limit hit; back off and retry.",
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
