import fs from "node:fs"
import path from "node:path"

export const CONFIG_VERSION = 1

export type Theme = "system" | "light" | "dark"

/**
 * Translation settings.
 *
 * Credentials are stored **per provider** rather than in one flat block, so
 * switching vendors keeps the previous vendor's keys and adding a vendor needs
 * no change here.
 *
 * They are plain text in config.json. That is the trade-off the app takes: it is
 * a single-user desktop application with no server to hold a secret, and a key
 * the user cannot read is a key they cannot fix. `DESIGN.md` records it as a
 * known limitation, and the file never leaves `%APPDATA%`.
 */
export interface TranslateConfig {
  /** Provider id, e.g. "tencent". */
  provider: string
  /** "auto" resolves locally before the vendor is called. */
  sourceLang: string
  targetLang: string
  /** providerId -> fieldKey -> value (including secrets). */
  credentials: Record<string, Record<string, string>>
}

export interface AppConfig {
  version: number
  /** null means "use the default under Documents". */
  libraryDir: string | null
  theme: Theme
  autoCheckUpdates: boolean
  translate: TranslateConfig
}

export function defaultTranslateConfig(): TranslateConfig {
  return { provider: "tencent", sourceLang: "auto", targetLang: "zh", credentials: {} }
}

export function defaultConfig(): AppConfig {
  return {
    version: CONFIG_VERSION,
    libraryDir: null,
    theme: "system",
    autoCheckUpdates: true,
    translate: defaultTranslateConfig(),
  }
}

/** Keeps only string values, so a hand-edited file cannot inject objects. */
function stringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function coerceTranslate(raw: unknown): TranslateConfig {
  const defaults = defaultTranslateConfig()
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults
  const record = raw as Record<string, unknown>

  const credentials: Record<string, Record<string, string>> = {}
  if (record.credentials && typeof record.credentials === "object" && !Array.isArray(record.credentials)) {
    for (const [providerId, fields] of Object.entries(record.credentials as Record<string, unknown>)) {
      credentials[providerId] = stringRecord(fields)
    }
  }

  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() !== "" ? value : fallback

  return {
    provider: text(record.provider, defaults.provider),
    sourceLang: text(record.sourceLang, defaults.sourceLang),
    targetLang: text(record.targetLang, defaults.targetLang),
    credentials,
  }
}

function coerce(raw: unknown): AppConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultConfig()

  const record = raw as Record<string, unknown>
  const theme = record.theme

  return {
    version: CONFIG_VERSION,
    libraryDir:
      typeof record.libraryDir === "string" && record.libraryDir.trim() !== ""
        ? record.libraryDir
        : null,
    theme: theme === "light" || theme === "dark" ? theme : "system",
    autoCheckUpdates:
      typeof record.autoCheckUpdates === "boolean" ? record.autoCheckUpdates : true,
    // Missing in every config written before translation existed; coerce fills it.
    translate: coerceTranslate(record.translate),
  }
}

/**
 * Reads config.json, always returning a usable config.
 *
 * A missing file yields defaults. A corrupt file yields defaults *and* is
 * rewritten, so a bad edit can never wedge startup. Unknown sections survive a
 * round trip only insofar as `coerce` knows them — this is the single place the
 * shape of the file is decided.
 */
export function readConfig(configFile: string): AppConfig {
  let text: string
  try {
    text = fs.readFileSync(configFile, "utf8")
  } catch {
    return defaultConfig()
  }

  try {
    return coerce(JSON.parse(text))
  } catch {
    console.warn(`[config] ${configFile} is not valid JSON; rewriting defaults`)
    const fallback = defaultConfig()
    try {
      writeConfig(configFile, fallback)
    } catch {
      // Best effort only — startup must not fail because of this.
    }
    return fallback
  }
}

/** Writes config.json atomically (temp file + rename). */
export function writeConfig(configFile: string, config: AppConfig): void {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  const tempFile = `${configFile}.tmp`
  fs.writeFileSync(tempFile, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  fs.renameSync(tempFile, configFile)
}
