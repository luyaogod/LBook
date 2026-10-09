import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import type { Settings } from "@shared/ipc";

/**
 * Dark mode, the shadcn way.
 *
 * The palette lives in CSS (`:root` and `.dark` in index.css) and components only
 * ever reference tokens. All this provider does is put the `dark` class on
 * `<html>` and remember the choice.
 *
 * The class is resolved from **two** inputs, not one:
 *
 * - an explicit choice ("light" / "dark") is taken at face value, so switching in
 *   the settings panel is instant and does not depend on a media-query event;
 * - "system" follows `prefers-color-scheme`.
 *
 * That media query already reports the *chosen* theme rather than the OS one,
 * because the main process points `nativeTheme.themeSource` at the setting (see
 * src/main/theme.ts). Resolution therefore also works before the settings have
 * been fetched: `theme` is "system" until they arrive, and the media query is
 * already right — which is what keeps the first paint from flashing white.
 */

export type ThemeChoice = Settings["theme"];

interface ThemeContextValue {
  /** What the user picked: "light" | "dark" | "system". */
  theme: ThemeChoice;
  /** What is actually on screen right now. */
  resolved: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Settings payload from main; null while it is still being fetched. */
  settings: Settings | null;
  onSettings: (settings: Settings) => void;
}

export function ThemeProvider({ children, settings, onSettings }: ThemeProviderProps) {
  const theme: ThemeChoice = settings?.theme ?? "system";
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  const resolved: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  // layout effect, not effect: the class has to be in place for the *first*
  // paint, otherwise a dark window shows its light palette for one frame.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    // Native widgets (select popups, scrollbars, caret) are painted by Chromium
    // and only follow `color-scheme`, not our CSS variables.
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  // The OS switched while we are following it. Kept separate from the effect
  // above so the listener is installed once.
  useLayoutEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback(
    (next: ThemeChoice) => {
      // Persist first, then let main's answer flow back through `settings`: that
      // keeps the class and the stored value in step even if the write fails.
      void window.api.settings.set({ theme: next }).then(onSettings);
    },
    [onSettings]
  );

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
