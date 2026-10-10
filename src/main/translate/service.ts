import type { TranslateProviderInfo, TranslateResult, TranslateSettingsView } from "../../shared/translate"
import type { AppConfig, TranslateConfig } from "../config/config"
import type { AppPaths } from "../paths"
import { createTranslateCache, translateCacheKey, type TranslateCache } from "./cache"
import { detectLanguage } from "./detect"
import { createProviderRegistry, type ProviderRegistry } from "./registry"
import { ProviderConfigError, type TranslateProvider } from "./types"

/**
 * The service layer for selection translation: which provider, which credentials,
 * whether the cache answers.
 *
 * It knows no specific vendor (those arrive through the `registry`) and never touches
 * the UI or a `.lbook`. A caller hands over text and gets a translation back.
 */

/** What the settings page may change. Empty string (or null) removes a field. */
export interface TranslateSettingsPatch {
  provider?: string
  sourceLang?: string
  targetLang?: string
  values?: Record<string, Record<string, string | null>>
}

export interface TranslateServiceDeps {
  getConfig: () => AppConfig
  /** Persists a new translate section; the service owns its shape. */
  updateConfig: (translate: TranslateConfig) => void
  paths: () => AppPaths
  registry?: ProviderRegistry
  cache?: TranslateCache
  fetchImpl?: typeof fetch
}

export interface SpeakOutput {
  audio: Uint8Array
  mime: string
}

export interface TranslateService {
  listProviders(): TranslateProviderInfo[]
  settingsView(): TranslateSettingsView
  updateSettings(patch: TranslateSettingsPatch): TranslateSettingsView
  translate(input: { text: string; source?: string; target?: string }): Promise<TranslateResult>
  /** Reads text aloud through the active provider; throws when it has no speech. */
  speak(input: { text: string; language: string }): Promise<SpeakOutput>
  dispose(): void
}

/** Audio kept in memory so clicking a speaker twice does not pay twice. */
const SPEAK_CACHE_LIMIT = 64

export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const registry = deps.registry ?? createProviderRegistry()
  const cache = deps.cache ?? createTranslateCache(deps.paths().translateCacheFile)
  /** key -> audio. Insertion order doubles as the eviction order. */
  const speechCache = new Map<string, SpeakOutput>()

  /** "auto" (or a missing hint) is resolved locally — see detect.ts for why. */
  function resolveSource(requested: string | undefined, text: string, fallback: string): string {
    const wanted = requested ?? fallback
    if (wanted !== "auto") return wanted
    return detectLanguage(text) ?? "en"
  }

  function settingsView(): TranslateSettingsView {
    const config = deps.getConfig().translate
    const values: Record<string, Record<string, string>> = {}

    for (const provider of registry.list()) {
      const stored = config.credentials[provider.id] ?? {}
      const visible: Record<string, string> = {}
      for (const field of provider.fields) {
        // Secrets are returned as-is: the settings page shows them masked and
        // lets the user reveal and copy them. See DESIGN.md 8.2.
        visible[field.key] = stored[field.key] ?? ""
      }
      values[provider.id] = visible
    }

    return {
      provider: config.provider,
      sourceLang: config.sourceLang,
      targetLang: config.targetLang,
      providers: registry.list(),
      values,
    }
  }

  function updateSettings(patch: TranslateSettingsPatch): TranslateSettingsView {
    const current = deps.getConfig().translate
    const next: TranslateConfig = {
      provider: patch.provider?.trim() || current.provider,
      sourceLang: patch.sourceLang?.trim() || current.sourceLang,
      targetLang: patch.targetLang?.trim() || current.targetLang,
      credentials: { ...current.credentials },
    }

    for (const [providerId, fields] of Object.entries(patch.values ?? {})) {
      const merged: Record<string, string> = { ...(next.credentials[providerId] ?? {}) }
      for (const [key, value] of Object.entries(fields)) {
        // The form is prefilled with what is stored, so an empty value is a real
        // instruction ("remove this key") rather than "I did not touch it".
        if (value === null || value === "") delete merged[key]
        else merged[key] = value
      }
      next.credentials[providerId] = merged
    }

    deps.updateConfig(next)
    return settingsView()
  }

  return {
    listProviders: () => registry.list(),
    settingsView,
    updateSettings,

    async translate(input) {
      const text = input.text.trim()
      if (text === "") throw new Error("Nothing is selected")

      const config = deps.getConfig().translate
      const provider: TranslateProvider = registry.resolve(config.provider)
      const source = resolveSource(input.source, text, config.sourceLang)
      const target = input.target?.trim() || config.targetLang

      // Already in the target language: calling the vendor would cost money to
      // return the same sentence.
      if (source === target) {
        return { text, source, target, provider: provider.id, cached: false }
      }

      const key = translateCacheKey({ provider: provider.id, source, target, text })
      const hit = cache.get(key)
      if (hit !== null) {
        return { text: hit, source, target, provider: provider.id, cached: true }
      }

      const credentials = config.credentials[provider.id] ?? {}
      const result = await provider.translate({ text, source, target }, credentials, deps.fetchImpl)
      cache.set(key, result.text)

      return { ...result, provider: provider.id, cached: false }
    },

    async speak(input) {
      const text = input.text.trim()
      if (text === "") throw new Error("There is no text to read aloud")

      const provider = registry.resolve(deps.getConfig().translate.provider)
      if (!provider.speak) throw new Error(`${provider.label} cannot read text aloud`)

      const key = `${provider.id}\u0000${input.language}\u0000${text}`
      const hit = speechCache.get(key)
      if (hit) return hit

      const credentials = deps.getConfig().translate.credentials[provider.id] ?? {}
      const result = await provider.speak({ text, language: input.language }, credentials, deps.fetchImpl)
      const output: SpeakOutput = { audio: result.audio, mime: result.mime }

      speechCache.set(key, output)
      if (speechCache.size > SPEAK_CACHE_LIMIT) {
        const oldest = speechCache.keys().next().value
        if (oldest !== undefined) speechCache.delete(oldest)
      }
      return output
    },

    dispose: () => cache.flush(),
  }
}

export { ProviderConfigError }
