import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

/**
 * Translation memory on disk.
 *
 * Every call costs money (the vendor's free allowance is finite and, for Tencent,
 * being withdrawn), and a reader highlights the same sentence more than once. So
 * answers are kept keyed by provider + languages + exact text.
 *
 * Deliberately a single JSON file rather than a directory of files: at a few
 * hundred KB for a whole book it stays cheap to load, and it is trivial to
 * inspect, copy or delete. It lives under the app's cache directory, so deleting
 * it must never lose anything the user would miss.
 */

export interface TranslateCache {
  get(key: string): string | null
  set(key: string, value: string): void
  size(): number
  /** Writes pending changes now; called on shutdown. */
  flush(): void
}

export interface TranslateCacheOptions {
  /** Entries kept before the oldest are dropped. */
  limit?: number
  /** How long `set` may batch writes. */
  flushDelayMs?: number
}

export function translateCacheKey(parts: {
  provider: string
  source: string
  target: string
  text: string
}): string {
  return createHash("sha256")
    .update(`${parts.provider}\u0000${parts.source}\u0000${parts.target}\u0000${parts.text}`, "utf8")
    .digest("hex")
}

function readEntries(file: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value
    }
    return out
  } catch {
    // A missing or corrupt cache is not an error state: the next call just runs.
    return {}
  }
}

export function createTranslateCache(file: string, options: TranslateCacheOptions = {}): TranslateCache {
  const limit = options.limit ?? 20_000
  const flushDelayMs = options.flushDelayMs ?? 400
  let entries: Record<string, string> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false

  function load(): Record<string, string> {
    if (entries === null) entries = readEntries(file)
    return entries
  }

  function writeNow(): void {
    if (!dirty || entries === null) return
    dirty = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      fs.writeFileSync(temp, `${JSON.stringify(entries)}\n`, "utf8")
      fs.renameSync(temp, file)
    } catch (error) {
      // Caching is an optimisation; failing to persist must never fail a translation.
      console.warn(`[translate] could not write ${file}: ${error instanceof Error ? error.message : error}`)
    }
  }

  return {
    get(key) {
      return load()[key] ?? null
    },

    set(key, value) {
      const all = load()
      all[key] = value
      dirty = true

      const keys = Object.keys(all)
      if (keys.length > limit) {
        // Insertion order is the eviction order: the oldest highlights go first.
        for (const stale of keys.slice(0, keys.length - limit)) delete all[stale]
      }

      if (timer) clearTimeout(timer)
      timer = setTimeout(writeNow, flushDelayMs)
      // A pending timer must not keep the process alive on quit.
      timer.unref?.()
    },

    size: () => Object.keys(load()).length,
    flush: writeNow,
  }
}
