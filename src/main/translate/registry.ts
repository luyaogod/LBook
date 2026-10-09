import type { TranslateProviderInfo } from "../../shared/translate"
import type { TranslateProvider } from "./types"
import { tencentTranslateProvider } from "./providers/tencent"

/**
 * The vendors this build knows about.
 *
 * Adding one is a two-line change here plus its own file under `providers/`; no
 * other module references a vendor by name.
 */
export const TRANSLATE_PROVIDERS: TranslateProvider[] = [tencentTranslateProvider]

export interface ProviderRegistry {
  get(id: string): TranslateProvider | null
  /** Metadata for the settings UI — function fields are dropped deliberately. */
  list(): TranslateProviderInfo[]
  /** The provider to use for `id`, falling back to the first known one. */
  resolve(id: string): TranslateProvider
}

function toInfo(provider: TranslateProvider): TranslateProviderInfo {
  return {
    id: provider.id,
    label: provider.label,
    fields: provider.fields,
    languages: provider.languages,
  }
}

export function createProviderRegistry(providers: TranslateProvider[] = TRANSLATE_PROVIDERS): ProviderRegistry {
  if (providers.length === 0) throw new Error("translate: no providers registered")
  const byId = new Map(providers.map((provider) => [provider.id, provider]))

  return {
    get: (id) => byId.get(id) ?? null,
    list: () => providers.map(toInfo),
    resolve: (id) => byId.get(id) ?? providers[0],
  }
}
