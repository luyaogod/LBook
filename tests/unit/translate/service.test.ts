import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { defaultConfig, type AppConfig } from "../../../src/main/config/config"
import { resolvePaths } from "../../../src/main/paths"
import { createTranslateCache } from "../../../src/main/translate/cache"
import { createProviderRegistry } from "../../../src/main/translate/registry"
import { createTranslateService } from "../../../src/main/translate/service"
import { ProviderConfigError, type TranslateProvider } from "../../../src/main/translate/types"
import { tencentTranslateProvider } from "../../../src/main/translate/providers/tencent"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-translate-"))
  return dir
}

/** A vendor that records its calls, so no test ever touches the network. */
function fakeProvider(overrides: Partial<TranslateProvider> = {}) {
  const calls: Array<{ text: string; source: string; target: string }> = []
  const spoken: Array<{ text: string; language: string }> = []
  const provider: TranslateProvider = {
    id: "fake",
    label: "Fake MT",
    languages: ["zh", "en"],
    fields: [
      { key: "token", label: "Token", secret: true },
      { key: "region", label: "Region" },
    ],
    async translate(input) {
      calls.push(input)
      return { text: `<${input.target}>${input.text}`, source: input.source, target: input.target }
    },
    async speak(input) {
      spoken.push(input)
      return { audio: Buffer.from(`audio:${input.language}:${input.text}`, "utf8"), mime: "audio/mpeg" }
    },
    ...overrides,
  }
  return { provider, calls, spoken }
}

function serviceWith(provider: TranslateProvider, credentials: AppConfig["translate"]["credentials"] = {}) {
  const root = tempDir()
  const paths = resolvePaths({ userDataDir: root, libraryDir: root })
  let config: AppConfig = {
    ...defaultConfig(),
    translate: { provider: provider.id, sourceLang: "auto", targetLang: "zh", credentials },
  }

  const service = createTranslateService({
    getConfig: () => config,
    updateConfig: (translate) => {
      config = { ...config, translate }
    },
    paths: () => paths,
    registry: createProviderRegistry([provider]),
    // Flush on every set, so assertions never race a timer.
    cache: createTranslateCache(paths.translateCacheFile, { flushDelayMs: 0 }),
  })

  return { service, configFile: paths.configFile, current: () => config }
}

describe("translate service", () => {
  it("translates through the configured provider", async () => {
    const { provider, calls } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    const result = await service.translate({ text: "Hello" })

    expect(result.text).toBe("<zh>Hello")
    expect(result.source).toBe("en")
    expect(result.target).toBe("zh")
    expect(result.provider).toBe("fake")
    expect(calls).toHaveLength(1)
  })

  it("resolves \"auto\" locally, because the vendor's detector was withdrawn", async () => {
    const { provider, calls } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    // Target English, or the Chinese sample would short-circuit as "already in
    // the target language" and never reach the provider.
    await service.translate({ text: "这是一段中文", target: "en" })
    expect(calls[0].source).toBe("zh")

    await service.translate({ text: "This is English" })
    expect(calls[1].source).toBe("en")
  })

  it("answers from cache the second time, and does not pay twice", async () => {
    const { provider, calls } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    const first = await service.translate({ text: "Hello there" })
    const second = await service.translate({ text: "Hello there" })

    expect(first.cached).toBe(false)
    expect(second.cached).toBe(true)
    expect(second.text).toBe(first.text)
    expect(calls).toHaveLength(1)
  })

  it("does not call the vendor when the text is already in the target language", async () => {
    const { provider, calls } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    const result = await service.translate({ text: "这是一段中文", target: "zh" })

    expect(result.text).toBe("这是一段中文")
    expect(calls).toHaveLength(0)
  })

  it("rejects an empty selection before spending a call", async () => {
    const { provider, calls } = fakeProvider()
    const { service } = serviceWith(provider)
    await expect(service.translate({ text: "   " })).rejects.toThrow(/没有选中/)
    expect(calls).toHaveLength(0)
  })

  it("falls back to the first provider when the configured id is unknown", () => {
    const { provider } = fakeProvider()
    const registry = createProviderRegistry([provider])
    expect(registry.resolve("nobody").id).toBe("fake")
    expect(registry.get("nobody")).toBeNull()
  })

  it("returns stored credentials so the settings page can show and copy them", () => {
    // Reversed on purpose: the field is prefilled (masked by the input type) and
    // the eye button reveals it for copying, which is what the user asked for.
    const { provider } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "s3cret", region: "ap-shanghai" } })

    const view = service.settingsView()
    expect(view.values.fake.token).toBe("s3cret")
    expect(view.values.fake.region).toBe("ap-shanghai")
  })

  it("treats an emptied field as a request to remove it", () => {
    const { provider } = fakeProvider()
    const { service, current } = serviceWith(provider, { fake: { token: "keep-me", region: "old" } })

    service.updateSettings({ values: { fake: { region: "ap-guangzhou" } } })
    expect(current().translate.credentials.fake).toEqual({ token: "keep-me", region: "ap-guangzhou" })

    // The form is prefilled, so "" is a real instruction rather than "untouched".
    service.updateSettings({ values: { fake: { token: "" } } })
    expect(current().translate.credentials.fake).toEqual({ region: "ap-guangzhou" })

    service.updateSettings({ values: { fake: { region: null } } })
    expect(current().translate.credentials.fake).toEqual({})
  })

  it("persists the provider and language choices", () => {
    const { provider } = fakeProvider()
    const { service, current } = serviceWith(provider)

    service.updateSettings({ provider: "fake", sourceLang: "en", targetLang: "zh" })

    expect(current().translate.provider).toBe("fake")
    expect(current().translate.sourceLang).toBe("en")
  })

  it("reports missing credentials as a configuration error, not a network one", async () => {
    const root = tempDir()
    const fetchSpy = vi.fn()
    const service = createTranslateService({
      getConfig: () => ({ ...defaultConfig(), translate: { ...defaultConfig().translate, provider: "tencent" } }),
      updateConfig: () => {},
      paths: () => resolvePaths({ userDataDir: root, libraryDir: root }),
      registry: createProviderRegistry([tencentTranslateProvider]),
      cache: createTranslateCache(path.join(root, "cache.json")),
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    await expect(service.translate({ text: "Hello" })).rejects.toBeInstanceOf(ProviderConfigError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("speech", () => {
  it("reads text through the active provider and caches the audio", async () => {
    const { provider, spoken } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    const first = await service.speak({ text: "Hello", language: "en" })
    const second = await service.speak({ text: "Hello", language: "en" })

    expect(spoken).toHaveLength(1)
    expect(Buffer.from(first.audio).toString("utf8")).toBe("audio:en:Hello")
    expect(first.mime).toBe("audio/mpeg")
    expect(second.audio).toBe(first.audio)
  })

  it("keeps audio for different languages apart", async () => {
    const { provider, spoken } = fakeProvider()
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    await service.speak({ text: "Hello", language: "en" })
    await service.speak({ text: "Hello", language: "zh" })

    expect(spoken.map((call) => call.language)).toEqual(["en", "zh"])
  })

  it("says so plainly when the vendor has no speech service", async () => {
    const { provider } = fakeProvider({ speak: undefined })
    const { service } = serviceWith(provider, { fake: { token: "t" } })

    await expect(service.speak({ text: "Hello", language: "en" })).rejects.toThrow(/不支持语音朗读/)
  })

  it("refuses over-long text before spending a synthesis request", async () => {
    const fetchSpy = vi.fn()
    const root = tempDir()
    const service = createTranslateService({
      getConfig: () => ({
        ...defaultConfig(),
        translate: {
          ...defaultConfig().translate,
          provider: "tencent",
          credentials: { tencent: { secretId: "AKIDx", secretKey: "k" } },
        },
      }),
      updateConfig: () => {},
      paths: () => resolvePaths({ userDataDir: root, libraryDir: root }),
      registry: createProviderRegistry([tencentTranslateProvider]),
      cache: createTranslateCache(path.join(root, "cache.json")),
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })

    // 501 Latin letters, one over the documented per-request limit.
    await expect(service.speak({ text: "a".repeat(501), language: "en" })).rejects.toThrow(
      /超过单次朗读上限/,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
