import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { resolveLocale, type LocaleChoice } from "."

interface LocaleProviderProps {
  /** What settings say; undefined while they are still being fetched. */
  choice: LocaleChoice | undefined
  children: React.ReactNode
}

/**
 * Applies the chosen language.
 *
 * Two things, both imperatively, because they are not React state: the locale
 * i18next renders with, and `document.documentElement.lang` (screen readers and
 * the native spell-checker read the latter, and it costs one line to keep true).
 *
 * The language is *not* stored here — settings own it, exactly like the theme.
 * Until they arrive, `resolveLocale` already answers correctly for the common
 * case, so the first paint is in the right language rather than flashing.
 */
export function LocaleProvider({ choice, children }: LocaleProviderProps) {
  const resolved = resolveLocale(choice)
  const { i18n } = useTranslation()

  useEffect(() => {
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved)
    document.documentElement.lang = resolved
  }, [i18n, resolved])

  return children
}
