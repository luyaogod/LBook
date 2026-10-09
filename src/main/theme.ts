import { nativeTheme, type BrowserWindow } from "electron"
import type { Theme } from "./config/config"

/**
 * One place that decides what "dark" means for the parts of the window the app
 * does not paint itself.
 *
 * `nativeTheme.themeSource` is the important half: it is what makes
 * `prefers-color-scheme` in the renderer report the *chosen* theme rather than
 * the OS one. The renderer then needs no theme plumbing beyond applying `.dark`
 * from a media query, and there is no flash of the wrong theme at startup:
 * Chromium knows the answer before the first paint.
 *
 * The other half is `backgroundColor`, which is what the user sees for the few
 * milliseconds before the first frame — and behind a window that is being
 * resized. It has to be the same colour as the app's own background
 * (`--background`), or a dark window shows a lighter rectangle while it paints.
 */

export type ResolvedTheme = "light" | "dark"

interface WindowColors {
  background: string
  /** Windows draws the resize border; keep it in step with the theme. */
  symbol: string
}

/** `--background` in light (#ffffff) and dark (oklch(0.145 0 0) = #0a0a0a). */
const WINDOW_COLORS: Record<ResolvedTheme, WindowColors> = {
  light: { background: "#ffffff", symbol: "#3f3f46" },
  dark: { background: "#0a0a0a", symbol: "#e5e5e5" },
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  return theme
}

export function windowColors(theme: Theme): WindowColors {
  return WINDOW_COLORS[resolveTheme(theme)]
}

/** Points Electron at the chosen theme. Returns what it resolved to. */
export function applyNativeTheme(theme: Theme): ResolvedTheme {
  nativeTheme.themeSource = theme
  return resolveTheme(theme)
}

/**
 * Repaints the window after a theme change.
 *
 * There is deliberately no `setTitleBarOverlay` here: the window controls are
 * drawn by the app (see AppHeader) instead of by Windows, so that all three look
 * alike and sit on the header's own colour. With the native overlay, Windows
 * paints its own strip — a different colour from our header — and hovers the
 * close button in the system red while the other two stay grey.
 */
export function paintWindow(win: BrowserWindow, theme: Theme): void {
  win.setBackgroundColor(windowColors(theme).background)
}
