import i18next, { type TFunction } from "i18next"
import { initReactI18next } from "react-i18next"
import type { LocaleChoice } from "@shared/ipc"
import { en, type TranslationKeys } from "./en"
import { zhCN } from "./zh-CN"

/**
 * The interface's languages.
 *
 * English is the source of truth and the fallback: a key that exists only in
 * `en.ts` shows English in every locale, which is the honest behaviour while a
 * translation is incomplete.
 */
export const LOCALES = { en, "zh-CN": zhCN } as const

export type LocaleId = keyof typeof LOCALES

export type { LocaleChoice }

/**
 * Name of a language code, for the pickers and the popup.
 *
 * The codes are an open set — a translation provider advertises its own — so this
 * is the one place that builds a key at runtime. `defaultValue` keeps an
 * untranslated code readable instead of printing the key itself.
 */
export function languageLabel(t: TFunction, code: string | undefined): string {
  if (!code) return ""
  return String(t(`language.${code}` as TranslationKeys, { defaultValue: code }))
}

/**
 * Text a vendor supplied: prefer its translation key, fall back to its own string.
 *
 * Providers declare both (`labelKey` + English `label`) so the interface can be
 * translated while a provider that ships no keys still renders.
 */
export function textFor(t: TFunction, key: string | undefined, fallback: string): string {
  if (!key) return fallback
  return String(t(key as TranslationKeys, { defaultValue: fallback }))
}

/**
 * Turns a stored choice into a locale we have.
 *
 * `undefined` means the settings payload has not arrived yet, and it resolves to
 * the stored default (English) rather than to the system language: guessing from
 * the OS here would flash the wrong language at someone who chose English.
 * `navigator.language` is Chromium's view of the OS setting, so "system" needs no
 * IPC.
 */
export function resolveLocale(choice: LocaleChoice | undefined, systemLanguage?: string): LocaleId {
  if (choice === "en" || choice === "zh-CN") return choice
  if (choice === undefined) return "en"
  const language = systemLanguage ?? (typeof navigator === "undefined" ? "en" : navigator.language)
  return language.toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: "en",
  fallbackLng: "en",
  // React escapes interpolated values already; doing it twice would show &amp;.
  interpolation: { escapeValue: false },
  returnNull: false,
})

export default i18next
