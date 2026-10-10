import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createProgressStore, parseProgress } from "../../../src/main/progress"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function storeFile(): string {
  dir ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-progress-"))
  return path.join(dir, "progress.json")
}

describe("progress store", () => {
  it("starts empty when there is no file yet", () => {
    const store = createProgressStore({ file: storeFile() })
    expect(store.get("uid-a")).toBeNull()
    expect(store.all()).toEqual({})
  })

  it("remembers a position per uid and writes readable JSON", () => {
    const file = storeFile()
    const store = createProgressStore({ file, now: () => "2026-01-01T00:00:00.000Z" })

    const saved = store.save("uid-a", 42)
    expect(saved).toEqual({ uid: "uid-a", last_page_num: 42, updated_at: "2026-01-01T00:00:00.000Z" })

    // Two-space indent and a trailing newline, the same as every other file the
    // app writes (B5).
    const text = fs.readFileSync(file, "utf8")
    expect(text.endsWith("\n")).toBe(true)
    expect(text).toContain('\n  "uid-a": {')
  })

  it("keeps books apart and updates in place", () => {
    const store = createProgressStore({ file: storeFile() })
    store.save("uid-a", 10)
    store.save("uid-b", 20)
    store.save("uid-a", 30)

    expect(store.get("uid-a")?.last_page_num).toBe(30)
    expect(store.get("uid-b")?.last_page_num).toBe(20)
    expect(Object.keys(store.all())).toEqual(["uid-a", "uid-b"])
  })

  it("survives a reload, so a restart keeps the reader's place", () => {
    const file = storeFile()
    createProgressStore({ file }).save("uid-a", 7)
    expect(createProgressStore({ file }).get("uid-a")?.last_page_num).toBe(7)
  })

  it("drops entries for books that are no longer in the library", () => {
    const file = storeFile()
    const store = createProgressStore({ file })
    store.save("uid-a", 10)
    store.save("uid-b", 20)

    store.keep(new Set(["uid-b"]))
    expect(store.get("uid-a")).toBeNull()
    expect(store.get("uid-b")?.last_page_num).toBe(20)
    // And the removal is on disk, not just in memory.
    expect(createProgressStore({ file }).get("uid-a")).toBeNull()
  })

  it("ignores a corrupt file instead of failing to start", () => {
    const file = storeFile()
    fs.writeFileSync(file, "{ not json", "utf8")
    const store = createProgressStore({ file })
    expect(store.all()).toEqual({})
    // The next save rewrites the file, so the damage does not persist.
    store.save("uid-a", 3)
    expect(createProgressStore({ file }).get("uid-a")?.last_page_num).toBe(3)
  })

  it("keeps the entries that parse and skips the ones that do not", () => {
    expect(
      parseProgress({
        good: { lastPageNum: 12, updatedAt: "2026-01-01T00:00:00.000Z" },
        zero: { lastPageNum: 0, updatedAt: "" },
        text: { lastPageNum: "9" },
        junk: "nope",
        // A missing timestamp is not worth dropping the entry over.
        noDate: { lastPageNum: 4 },
      }),
    ).toEqual({
      good: { lastPageNum: 12, updatedAt: "2026-01-01T00:00:00.000Z" },
      noDate: { lastPageNum: 4, updatedAt: "" },
    })
  })

  it("rejects a top-level array, which is not a progress map", () => {
    expect(() => parseProgress([1, 2])).toThrow(/not a JSON object/)
  })
})
