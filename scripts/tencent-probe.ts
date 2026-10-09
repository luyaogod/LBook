/**
 * 腾讯云接口连通性探针。
 *
 *   node scripts/run.mjs tencent-probe [--keys <file>] [--text "..."] [--voice 101001]
 *
 * 只做一件事：用真实密钥把两个接口各打一次，把 RequestId、返回体和错误码原样
 * 打出来。**不写库、不碰 `.lbook`、不改配置**——先把"能不能通"和"密钥对不对"
 * 这两个问题从功能开发里隔离出来。
 *
 * 密钥来源（按优先级）：
 *   1. 环境变量 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY（官方 SDK 的命名）
 *      也接受 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 与 TENCENT_SECURITY_TOKEN
 *   2. `--keys <file>` 指向的 JSON：{ "secretId": "...", "secretKey": "...", "token"?: "..." }
 *   3. 默认路径 %TEMP%\lbook-tencent-keys.json
 *
 * 密钥只在本进程内存里，不落盘、不进仓库。
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

  // ---- 语音合成 -----------------------------------------------------------
  console.log("[1/2] 语音合成 TextToVoice")
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

  // ---- 机器翻译 -----------------------------------------------------------
  // 文档说 TextTranslate 已在 2026-07-08 那次发布里删除、并将在 2027-10-01 归零，
  // 所以这一调用同时也是"这个接口现在还活着吗"的探针。
  console.log("")
  console.log("[2/2] 机器翻译 TextTranslate（英译中）")
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
