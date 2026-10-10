/**
 * English is the source of truth for the interface.
 *
 * Every key that can be shown to a user lives here first, and `i18next.d.ts`
 * types `t()` against this object — so a typo in a key is a compile error rather
 * than a missing label at runtime, which is the part JSON dictionaries normally
 * give up.
 *
 * Where a *provider* (translation vendor) carries its own field text, the key
 * lives here too and the provider keeps the English string inline as its
 * fallback. That way a third-party provider that ships no keys still renders.
 */
export const en = {
  // Language names — shared by the translation settings and the selection popup.
  "language.auto": "Auto-detect",
  "language.zh": "Chinese (Simplified)",
  "language.en": "English",
  "language.ja": "Japanese",
  "language.ko": "Korean",
  "language.fr": "French",
  "language.de": "German",
  "language.es": "Spanish",
  "language.ru": "Russian",

  // Settings shell.
  "settings.title": "Settings",
  "settings.close": "Close",

  // General.
  "settings.appearance.title": "Appearance",
  "settings.appearance.desc":
    "With System, follows the operating system's light/dark setting. The choice is written to config.json.",
  "settings.appearance.light": "Light",
  "settings.appearance.dark": "Dark",
  "settings.appearance.system": "System",
  "settings.appearance.current": "Currently: {{value}}",
  "settings.appearance.currentSystem": "System ({{value}})",

  // Language.
  "settings.language.title": "Language",
  "settings.language.desc":
    "English is the source of truth; other languages follow it, and anything not translated yet falls back to English.",
  "settings.language.system": "Follow the system",
  "settings.language.current": "Currently: {{value}}",
  "settings.language.currentSystem": "System ({{value}})",

  // Font size.
  "settings.font.title": "Font size",
  "settings.font.desc": "Size of the text in the reading panel, in pixels. Markdown and Blocks share it.",
  "settings.font.range": "{{min}}–{{max}}px, default {{default}}. Written to config.json, so it survives a restart.",
  "settings.font.reset": "Reset to default",

  // Translate.
  "settings.translate.provider": "Provider",
  "settings.translate.providerDesc": "Which service translates a selection.",
  "settings.translate.languages": "Languages",
  "settings.translate.languagesDesc":
    'With the source set to "Auto-detect", the language is decided locally from the selection.',
  "settings.translate.save": "Save",
  "settings.translate.test": "Test translation",
  "settings.translate.saved": "Saved",
  "settings.translate.clear": "Clear (takes effect when saved)",
  "settings.translate.show": "Show",
  "settings.translate.hide": "Hide",
  "settings.translate.secretPlaceholder": "Leave empty and save to remove this key",
  "settings.translate.testSample": "Accounting is the language of business.",
  "settings.translate.testOk": "{{source}} → {{target}}: {{text}}",
  "settings.translate.testOkCached": "{{source}} → {{target}}: {{text}} (cached)",

  // Selection popup.
  "translate.icon": "Translate the selected text",
  "translate.speakSource": "Read the original",
  "translate.speakTarget": "Read the translation",
  "translate.stopSpeaking": "Stop reading",
  "translate.copy": "Copy the translation",
  "translate.cached": "cached",
  "translate.cachedHint": "Answered from the local cache; no request was made",
  "translate.inProgress": "Translating…",
  "translate.openSettings": "Open settings",

  // Provider field text (vendors keep an English fallback inline).
  "provider.tencent.label": "Tencent Cloud",
  "provider.tencent.region": "Region",
  "provider.tencent.secretId.hint":
    "Access Management → API Keys. A sub-account key limited to translation is best.",
  "provider.tencent.secretKey.hint": "Shown once at creation; save it immediately.",
} as const

export type TranslationKeys = keyof typeof en
