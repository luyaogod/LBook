import fs from "node:fs"
import path from "node:path"
import type { ReadingProgress } from "../shared/types"

/**
 * Where the reader left off, per book.
 *
 * Deliberately **not** inside the book folder: "page 98" is where *this* machine
 * stopped reading, not something about the book. Putting it in the book would
 * make a read-only mount, a network share or a git repository unhappy for no
 * gain (B2 in `.agents/plan/00-decisions.md`).
 *
 * Keyed by `meta.json.uid`, so renaming or moving a book folder keeps its place.
 * The file is a plain map and is rewritten atomically: losing it costs a reader
 * their place, which is annoying but not destructive, so a corrupt file degrades
 * to "no progress" instead of refusing to start.
 */

export interface ProgressStore {
  get(uid: string): ReadingProgress | null
  /**
   * Writes a position. No range check: the caller owns the book and knows its
   * page count (see `library.saveProgress`), and the migration writes rows for
   * books whose page count changed since they were recorded.
   */
  save(uid: string, lastPageNum: number, updatedAt?: string): ReadingProgress
  /** Drops entries for books that are no longer in the library. */
  keep(known: Set<string>): void
  /** Everything, for the migration to compare against the old database. */
  all(): Record<string, { lastPageNum: number; updatedAt: string }>
}

interface StoredEntry {
  lastPageNum: number
  updatedAt: string
}

export interface ProgressStoreInput {
  /** Path of `progress.json`. */
  file: string
  /** Injected for deterministic tests. */
  now?: () => string
}

export function createProgressStore(input: ProgressStoreInput): ProgressStore {
  const now = input.now ?? (() => new Date().toISOString())
  let entries: Record<string, StoredEntry> = {}

  try {
    entries = parseProgress(JSON.parse(fs.readFileSync(input.file, "utf8")))
  } catch (error) {
    // A missing file is the normal first run; a corrupt one is reported and
    // dropped rather than thrown, because the reader's next page change rewrites
    // it anyway.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[progress] ignoring ${input.file}: ${(error as Error).message}`)
    }
  }

  const persist = (): void => {
    fs.mkdirSync(path.dirname(input.file), { recursive: true })
    const temp = `${input.file}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`, "utf8")
    fs.renameSync(temp, input.file)
  }

  const toProgress = (uid: string, entry: StoredEntry): ReadingProgress => ({
    uid,
    last_page_num: entry.lastPageNum,
    updated_at: entry.updatedAt,
  })

  return {
    get(uid) {
      const entry = entries[uid]
      return entry ? toProgress(uid, entry) : null
    },

    save(uid, lastPageNum, updatedAt) {
      const entry: StoredEntry = { lastPageNum, updatedAt: updatedAt ?? now() }
      entries = { ...entries, [uid]: entry }
      persist()
      return toProgress(uid, entry)
    },

    keep(known) {
      const kept: Record<string, StoredEntry> = {}
      let dropped = 0
      for (const [uid, entry] of Object.entries(entries)) {
        if (known.has(uid)) kept[uid] = entry
        else dropped += 1
      }
      if (dropped === 0) return
      entries = kept
      persist()
    },

    all: () => ({ ...entries }),
  }
}

/**
 * Reads the stored map, keeping the entries that make sense.
 *
 * A hand-edited file should cost the reader the lines they broke, not the whole
 * file: a bad entry is skipped and the rest of the map survives.
 */
export function parseProgress(raw: unknown): Record<string, StoredEntry> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("progress.json is not a JSON object")
  }

  const entries: Record<string, StoredEntry> = {}
  for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const page = record.lastPageNum
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1) continue
    entries[uid] = {
      lastPageNum: page,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    }
  }
  return entries
}
