/**
 * A connectivity probe for the Tencent Cloud endpoints.
 *
 *   node scripts/run.mjs tencent-probe [--keys <file>] [--text "..."] [--voice 101001]
 *
 * It does one thing: calls both endpoints once with real credentials and prints the
 * RequestId, the response body and any error code verbatim. **It writes nothing, reads
 * no book and touches no configuration** — the point is to answer "can we reach it"
 * and "are the keys right" separately from whether the feature works.
 *
 * Where the credentials come from, in order:
 *   1. TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY (the official SDK's names);
 *      TENCENT_SECRET_ID / TENCENT_SECRET_KEY and TENCENT_SECURITY_TOKEN also work
 *   2. the JSON that `--keys <file>` points at: { "secretId": …, "secretKey": …, "token"?: … }
 *   3. %TEMP%\lbook-tencent-keys.json
 *
 * They stay in this process's memory: never written to disk, never committed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { callTencentApi, TencentApiFailure } from "../src/main/tencent/client"
import { explainTtsError, textToVoice } from "../src/main/tencent/tts"
import type { TencentCredentials } from "../src/main/tencent/sign"

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function loadCredentials(): { credentials: TencentCredentials; source: string } {
  const fromEnv: TencentCredentials = {
    secretId: process.env.TENCENTCLOUD_SECRET_ID ?? process.env.TENCENT_SECRET_ID ?? "",
    secretKey: process.env.TENCENTCLOUD_SECRET_KEY ?? process.env.TENCENT_SECRET_KEY ?? "",
    token: process.env.TENCENT_SECURITY_TOKEN ?? process.env.TENCENTCLOUD_TOKEN ?? undefined,
  }
  if (fromEnv.secretId && fromEnv.secretKey) return { credentials: fromEnv, source: "environment" }

  const candidates = [argValue("keys"), path.join(tmpdir(), "lbook-tencent-keys.json")].filter(
    (value): value is string => Boolean(value),
  )
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<TencentCredentials>
    if (!parsed.secretId || !parsed.secretKey) {
      throw new Error(`${file} needs both "secretId" and "secretKey"`)
    }
    return {
      credentials: { secretId: parsed.secretId, secretKey: parsed.secretKey, token: parsed.token },
      source: file,
    }
  }

  throw new Error(
    [
      "找不到密钥。三选一：",
      "  a) 设置环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY",
      `  b) 写一个 JSON 到 ${path.join(tmpdir(), "lbook-tencent-keys.json")}`,
      '     { "secretId": "AKID...", "secretKey": "..." }',
      "  c) node scripts/run.mjs tencent-probe --keys <你的 json 路径>",
    ].join("\n"),
  )
}

function reportFailure(label: string, error: unknown): void {
  if (error instanceof TencentApiFailure) {
    console.log(`${label} 失败  ${error.code}${error.requestId ? `  RequestId=${error.requestId}` : ""}`)
    console.log(`  ${error.message}`)
    const hint = explainTtsError(error.code)
    if (hint) console.log(`  → ${hint}`)
    return
  }
  console.log(`${label} 失败  ${error instanceof Error ? error.message : String(error)}`)
}

async function main(): Promise<void> {
  const { credentials, source } = loadCredentials()
  const text = argValue("text") ?? "Accounting is the language of business."
  const voiceArg = argValue("voice")
  const voiceType = voiceArg ? Number(voiceArg) : undefined
  const region = argValue("region")

  console.log(`密钥来源: ${source}（SecretId ${credentials.secretId.slice(0, 8)}…）`)
  console.log(`SecretKey 长度: ${credentials.secretKey.length}`)
  console.log("")

  // ---- text to speech ------------------------------------------------------
  console.log("[1/2] text to speech: TextToVoice")
  try {
    const result = await textToVoice(
      credentials,
      {
        text,
        voiceType,
        primaryLanguage: 2, // 英文
        codec: "mp3",
        sampleRate: 16000,
        speed: 0,
        volume: 0,
        enableSubtitle: process.argv.includes("--subtitle"),
        region,
      },
    )
    const out = path.join(tmpdir(), `lbook-tts-probe.${result.codec}`)
    writeFileSync(out, result.audio)
    console.log(`  成功  RequestId=${result.requestId}`)
    console.log(`  音频 ${result.audio.length} 字节 -> ${out}`)
    console.log(`  SessionId=${result.sessionId}  字幕条目=${result.subtitles.length}`)
    // Timestamps are what make sentence-level highlighting possible while audio
    // plays; show the shape so the feature work has a concrete sample.
    for (const unit of result.subtitles.slice(0, 3)) {
      console.log(`    ${unit.BeginTime}-${unit.EndTime}ms  [${unit.BeginIndex},${unit.EndIndex})  ${unit.Text}${unit.Phoneme ? `  /${unit.Phoneme}/` : ""}`)
    }
  } catch (error) {
    reportFailure("  ", error)
  }

  // ---- machine translation -------------------------------------------------
  // The documentation says TextTranslate was removed in the 2026-07-08 release and
  // goes to zero QPS on 2027-10-01, so this call is also the probe for "is it still
  // answering at all".
  console.log("")
  console.log("[2/2] machine translation: TextTranslate (English -> Chinese)")
  try {
    const { data, requestId } = await callTencentApi<{ TargetText?: string; Source?: string; Target?: string }>({
      service: "tmt",
      action: "TextTranslate",
      version: "2018-03-21",
      region: region ?? "ap-guangzhou",
      credentials,
      payload: { SourceText: text, Source: "en", Target: "zh", ProjectId: 0 },
    })
    console.log(`  成功  RequestId=${requestId}`)
    console.log(`  ${data.Source} -> ${data.Target}: ${data.TargetText}`)
  } catch (error) {
    reportFailure("  ", error)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
