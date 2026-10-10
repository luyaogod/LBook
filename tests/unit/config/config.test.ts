import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CONFIG_VERSION,
  defaultConfig,
  defaultTranslateConfig,
  readConfig,
  writeConfig,
} from "../../../src/main/config/config"
import { READING_FONT_SIZE } from "../../../src/shared/ipc"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function tempConfigFile(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-config-"))
  return path.join(dir, "config.json")
}

describe("config", () => {
  it("returns defaults when the file does not exist", () => {
    expect(readConfig(tempConfigFile())).toEqual(defaultConfig())
  })

  it("round-trips a written config", () => {
    const file = tempConfigFile()
    writeConfig(file, {
      version: CONFIG_VERSION,
      libraryDir: "D:\\Books",
      theme: "dark",
      autoCheckUpdates: false,
      readingFontSize: 18,
      translate: {
        provider: "tencent",
        sourceLang: "en",
        targetLang: "zh",
        credentials: { tencent: { secretId: "AKIDtest", secretKey: "shh", region: "ap-shanghai" } },
      },
    })

    expect(readConfig(file)).toEqual({
      version: CONFIG_VERSION,
      libraryDir: "D:\\Books",
      theme: "dark",
      autoCheckUpdates: false,
      readingFontSize: 18,
      translate: {
        provider: "tencent",
        sourceLang: "en",
        targetLang: "zh",
        credentials: { tencent: { secretId: "AKIDtest", secretKey: "shh", region: "ap-shanghai" } },
      },
    })
  })

  it("fills in the translate section for a config written before it existed", () => {
    // The important migration case: an existing installation upgrades in place.
    const file = tempConfigFile()
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, libraryDir: "D:\\Books", theme: "dark", autoCheckUpdates: false }),
      "utf8",
    )

    const config = readConfig(file)
    expect(config.translate).toEqual(defaultTranslateConfig())
    expect(config.libraryDir).toBe("D:\\Books")
  })

  it("drops non-string credential values instead of trusting the file", () => {
    const file = tempConfigFile()
    fs.writeFileSync(
      file,
      JSON.stringify({
        translate: { provider: "tencent", credentials: { tencent: { secretId: "ok", nested: { evil: true }, n: 7 } } },
      }),
      "utf8",
    )

    expect(readConfig(file).translate.credentials.tencent).toEqual({ secretId: "ok" })
  })

  it("self-heals a corrupt file instead of throwing", () => {
    const file = tempConfigFile()
    fs.writeFileSync(file, "{ this is not json", "utf8")

    expect(readConfig(file)).toEqual(defaultConfig())
    // Rewritten in place, so the next read is clean.
    expect(() => JSON.parse(fs.readFileSync(file, "utf8"))).not.toThrow()
  })

  it("falls back per-field on out-of-range values", () => {
    const file = tempConfigFile()
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 99, libraryDir: "", theme: "neon", autoCheckUpdates: "yes" }),
      "utf8",
    )

    expect(readConfig(file)).toEqual(defaultConfig())
  })

  it("defaults the reading font size for a config written before it existed", () => {
    const file = tempConfigFile()
    fs.writeFileSync(file, JSON.stringify({ version: 1, theme: "dark" }), "utf8")

    expect(readConfig(file).readingFontSize).toBe(READING_FONT_SIZE.default)
  })

  it("clamps and rounds the reading font size", () => {
    const cases: Array<[unknown, number]> = [
      [READING_FONT_SIZE.min - 1, READING_FONT_SIZE.min],
      [READING_FONT_SIZE.max + 1, READING_FONT_SIZE.max],
      [15.6, 16],
      ["18", READING_FONT_SIZE.default],
      [null, READING_FONT_SIZE.default],
      // Not a number at all — a hand edit, or a NaN that reached the file.
      [Number.NaN, READING_FONT_SIZE.default],
    ]

    for (const [stored, expected] of cases) {
      const file = tempConfigFile()
      fs.writeFileSync(file, JSON.stringify({ readingFontSize: stored }), "utf8")
      expect(readConfig(file).readingFontSize, `stored ${String(stored)}`).toBe(expected)
    }
  })

  it("keeps a valid libraryDir while repairing sibling fields", () => {
    const file = tempConfigFile()
    fs.writeFileSync(file, JSON.stringify({ libraryDir: "E:\\Lib", theme: "neon" }), "utf8")

    const config = readConfig(file)
    expect(config.libraryDir).toBe("E:\\Lib")
    expect(config.theme).toBe("system")
  })

  it("writes atomically without leaving a temp file behind", () => {
    const file = tempConfigFile()
    writeConfig(file, defaultConfig())
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })
})
