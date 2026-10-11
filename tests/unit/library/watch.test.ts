import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLibraryWatcher, type BookChange } from "../../../src/main/library/watch"
import { LBOOK_DIR } from "../../../src/shared/bookFile"

let root: string | undefined
const watchers: Array<{ dispose(): void }> = []

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.dispose()
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function tempDir(): string {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-watch-"))
  return root
}

/** A folder with the two files a book has. */
function bookFolder(name: string, uid: string): { uid: string; dir: string } {
  const dir = path.join(tempDir(), name)
  // The layout the app reads: book.pdf at the top, metadata in .lbook/.
  const dataDir = path.join(dir, LBOOK_DIR)
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, "meta.json"), JSON.stringify({ uid }))
  fs.writeFileSync(path.join(dataDir, "ocr.json"), JSON.stringify({ layoutParsingResults: [{}] }))
  return { uid, dir }
}

function watcher(options: { debounceMs?: number; pollMs?: number } = {}) {
  const changes: BookChange[] = []
  const instance = createLibraryWatcher({
    debounceMs: options.debounceMs ?? 20,
    pollMs: options.pollMs ?? 50,
    onWarn: () => {},
  })
  instance.onChange((change) => changes.push(change))
  watchers.push(instance)
  return { instance, changes }
}

/** Waits for a condition, checking every 10ms. Watch events are not synchronous. */
async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return condition()
}

describe("watching book folders", () => {
  it("reports a change to a tracked file, with the book it belongs to", async () => {
    const book = bookFolder("book-a", "uid-a")
    const { instance, changes } = watcher()
    instance.sync([book])

    fs.writeFileSync(path.join(book.dir, LBOOK_DIR, "ocr.json"), JSON.stringify({ layoutParsingResults: [{}], n: 1 }))

    expect(await waitFor(() => changes.length > 0)).toBe(true)
    expect(changes[0]).toMatchObject({ uid: "uid-a", dir: book.dir })
    expect(changes[0].changed).toContain("ocr.json")
  })

  it("coalesces the burst of writes an editor makes", async () => {
    const book = bookFolder("book-b", "uid-b")
    const { instance, changes } = watcher({ debounceMs: 40 })
    instance.sync([book])

    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(book.dir, LBOOK_DIR, "ocr.json"), `{"layoutParsingResults":[],"n":${i}}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(await waitFor(() => changes.length > 0)).toBe(true)
    // One report for the burst: the interface re-reads once, not five times.
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(changes).toHaveLength(1)
  })

  it("stops watching a book that is no longer in the list", async () => {
    const first = bookFolder("book-c", "uid-c")
    const second = bookFolder("book-d", "uid-d")
    const { instance, changes } = watcher()
    instance.sync([first, second])
    instance.sync([second])

    fs.writeFileSync(path.join(first.dir, LBOOK_DIR, "ocr.json"), JSON.stringify({ layoutParsingResults: [{}], n: 9 }))
    fs.writeFileSync(path.join(second.dir, LBOOK_DIR, "ocr.json"), JSON.stringify({ layoutParsingResults: [{}], n: 9 }))

    expect(await waitFor(() => changes.length > 0)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(changes.map((change) => change.uid)).toEqual(["uid-d"])
  })

  it("falls back to polling for a folder it cannot watch", async () => {
    // A folder that does not exist is the cheap stand-in for a network share whose
    // watch cannot attach.
    const missing = { uid: "uid-e", dir: path.join(tempDir(), "not-there") }
    const { instance, changes } = watcher({ pollMs: 40 })
    instance.sync([missing])

    expect(instance.degraded).toBe(true)
    expect(instance.unwatched()).toEqual([missing.dir])

    // The poll notices the folder appearing where a watch never could have.
    fs.mkdirSync(path.join(missing.dir, LBOOK_DIR), { recursive: true })
    fs.writeFileSync(path.join(missing.dir, LBOOK_DIR, "meta.json"), "{}")
    fs.writeFileSync(path.join(missing.dir, LBOOK_DIR, "ocr.json"), "{}")

    expect(await waitFor(() => changes.length > 0, 3000)).toBe(true)
    expect(changes[0].uid).toBe("uid-e")
  })

  it("says nothing after dispose", async () => {
    const book = bookFolder("book-f", "uid-f")
    const { instance, changes } = watcher()
    instance.sync([book])
    instance.dispose()

    fs.writeFileSync(path.join(book.dir, LBOOK_DIR, "ocr.json"), JSON.stringify({ layoutParsingResults: [{}], n: 2 }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(changes).toEqual([])
  })

  it("does not fire for a file nothing tracks… but does say something changed", async () => {
    // A cover or the PDF is not part of the freshness check, but it is still a
    // reason for the interface to re-read (the cover thumbnail lives in the list).
    const book = bookFolder("book-g", "uid-g")
    const { instance, changes } = watcher()
    instance.sync([book])

    fs.writeFileSync(path.join(book.dir, LBOOK_DIR, "cover.jpg"), "not really a jpeg")

    expect(await waitFor(() => changes.length > 0)).toBe(true)
    expect(changes[0].changed).toEqual(["other"])
  })
})
