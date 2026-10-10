import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Settings } from "@shared/ipc";
import { LOCALE_CHOICES } from "@shared/ipc";
import { useTheme, type ThemeChoice } from "@/components/theme/ThemeProvider";
import { resolveLocale, type LocaleChoice } from "@/i18n";

const THEME_ICONS: Record<ThemeChoice, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

const THEME_KEYS = {
  light: "settings.appearance.light",
  dark: "settings.appearance.dark",
  system: "settings.appearance.system",
} as const;

/**
 * A language names itself, in itself: a list of languages translated into the
 * current one is exactly the list a reader cannot read.
 */
const LOCALE_NATIVE: Record<"en" | "zh-CN", string> = { en: "English", "zh-CN": "简体中文" };

interface GeneralSettingsProps {
  settings: Settings;
  onSettings: (next: Settings) => void;
}

/**
 * General: appearance and language.
 *
 * Both are choices made once and then forgotten, so both are the same shape (a
 * row of cards) and both go straight to `settings:set`, which writes config.json
 * and hands the fresh payload back. The theme goes through `ThemeProvider`
 * because it also has to swap the class on <html>.
 */
export function GeneralSettings({ settings, onSettings }: GeneralSettingsProps) {
  const { t } = useTranslation();
  const { theme, resolved, setTheme } = useTheme();

  const localeName = (choice: LocaleChoice) =>
    choice === "system" ? t("settings.language.system") : LOCALE_NATIVE[choice];
  const resolvedLocale = resolveLocale(settings.locale);
  const setLocale = (locale: LocaleChoice) => {
    void window.api.settings.set({ locale }).then(onSettings);
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-foreground">{t("settings.appearance.title")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.appearance.desc")}</p>

        <div className="mt-3 grid grid-cols-3 gap-3">
          {(["light", "dark", "system"] as ThemeChoice[]).map((id) => {
            const Icon = THEME_ICONS[id];
            const active = theme === id;
            return (
              <button
                key={id}
                onClick={() => setTheme(id)}
                aria-pressed={active}
                className={`flex h-24 flex-col items-center justify-center gap-2 rounded-xl border text-sm transition-colors ${
                  active
                    ? "border-ring bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {t(THEME_KEYS[id])}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {theme === "system"
            ? t("settings.appearance.currentSystem", { value: t(THEME_KEYS[resolved]) })
            : t("settings.appearance.current", { value: t(THEME_KEYS[theme]) })}
        </p>
      </div>

      <div>
        <p className="text-sm font-medium text-foreground">{t("settings.language.title")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.language.desc")}</p>

        <div className="mt-3 grid grid-cols-3 gap-3">
          {LOCALE_CHOICES.map((choice) => {
            const active = settings.locale === choice;
            return (
              <button
                key={choice}
                onClick={() => setLocale(choice)}
                aria-pressed={active}
                className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm transition-colors ${
                  active
                    ? "border-ring bg-accent text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                }`}
              >
                {localeName(choice)}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {settings.locale === "system"
            ? t("settings.language.currentSystem", { value: LOCALE_NATIVE[resolvedLocale] })
            : t("settings.language.current", { value: LOCALE_NATIVE[resolvedLocale] })}
        </p>
      </div>
    </div>
  );
}
