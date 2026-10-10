/**
 * Translation contract shared by main, preload and renderer.
 *
 * The renderer must be able to draw a vendor's settings form without knowing
 * anything about that vendor, so a provider describes its own fields here. The
 * *values* travel separately, and secret ones never travel back at all.
 */

export interface ProviderFieldSpec {
  key: string
  /** English label, used as the fallback when `labelKey` has no translation. */
  label: string
  /**
   * Translation key for `label`.
   *
   * A provider carries both: the key so the interface can be translated, and the
   * English string so a vendor that ships no keys still renders. The renderer
   * prefers the key and falls back to the label.
   */
  labelKey?: string
  /** Rendered as a password box; the value is never sent back to the renderer. */
  secret?: boolean
  placeholder?: string
  /** Shown under the field to explain where the value comes from. */
  hint?: string
  /** Translation key for `hint`. */
  hintKey?: string
}

/** What the settings page needs to render one vendor. Never contains secrets. */
export interface TranslateProviderInfo {
  id: string
  label: string
  /** Translation key for `label`, resolved by the renderer. */
  labelKey?: string
  fields: ProviderFieldSpec[]
  /** Language codes this provider accepts, used to populate the pickers. */
  languages: string[]
}

export interface TranslateResult {
  /** The translated text. */
  text: string
  /** Language actually used as the source ("auto" is resolved before calling). */
  source: string
  target: string
  provider: string
  /** True when the answer came from the local cache instead of the vendor. */
  cached: boolean
}

/** The `settings.translate` payload sent to the renderer. */
export interface TranslateSettingsView {
  provider: string
  sourceLang: string
  targetLang: string
  providers: TranslateProviderInfo[]
  /**
   * providerId -> fieldKey -> value, **secrets included**.
   *
   * The settings page fills its inputs with these, so a stored key shows up as
   * dots and the eye button can reveal it for copying. Keeping it out of the
   * renderer only made the field unusable: a user cannot verify or copy a key
   * they are not allowed to see.
   */
  values: Record<string, Record<string, string>>
}
