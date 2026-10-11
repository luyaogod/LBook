import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLedgerStore } from "../../../src/main/library/ledger"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

interface Fixture {
  root: string
  file: string
  store: (overrides?: { now?: () => string }) => ReturnType<typeof createLedgerStore>
  /** A book folder inside the default new-book location. */
  inside(name: string): string
  /** A book folder somewhere else entirely (another drive, a network share). */
  outside(name: string): string
}

function fixture(): Fixture {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-ledger-"))
  const root = path.join(dir, "LBook Library")
  const outside = path.join(dir, "elsewhere")
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  const file = path.join(dir, "appdata", "library.json")
  return {
    root,
    file,
    store: (overrides) => createLedgerStore({ file, root, ...overrides }),
    inside: (name) => {
      const target = path.join(root, name)
      fs.mkdirSync(target, { recursive: true })
      return target
    },
    outside: (name) => {
      const target = path.join(outside, name)
      fs.mkdirSync(target, { recursive: true })
      return target
    },
  }
}

describe("ledger", () => {
  it("starts empty when there is no file yet", () => {
    const f = fixture()
    const store = f.store()
    expect(store.list()).toEqual([])
    expect(store.issues).toEqual([])
    expect(fs.existsSync(f.file)).toBe(false)
  })

  it("records books inside the default location relative, and others absolute", () => {
    const f = fixture()
    const store = f.store({ now: () => "2026-10-11T00:00:00.000Z" })

    const added = store.add(f.inside("BPP Financial Accounting"), "uid-bpp")
    const other = store.add(f.outside("Oxford"), "uid-ox")

    expect(added.outcome).toBe("added")
    expect(other.outcome).toBe("added")
    expect(added.ref.path).toBe("BPP Financial Accounting")
    expect(other.ref.path).toBe(f.outside("Oxford"))
    // Either way the folder comes back as an absolute directory.
    expect(store.resolve(added.ref)).toBe(f.inside("BPP Financial Accounting"))
    expect(store.resolve(other.ref)).toBe(f.outside("Oxford"))
    expect(store.list()).toHaveLength(2)
  })

  it("keeps the relative spelling when the whole library moves", () => {
    const f = fixture()
    f.store().add(f.inside("BPP"), "uid-bpp")

    // Simulate the user moving the default location: same ledger, new root.
    const moved = createLedgerStore({ file: f.file, root: path.join(path.dirname(f.root), "Renamed Library") })
    expect(moved.resolve(moved.list()[0])).toBe(path.join(path.dirname(f.root), "Renamed Library", "BPP"))
  })

  it("lists a book once, wherever its folder is now", () => {
    // The rule the app inherited from Obsidian's vault list: a book's identity is the
    // uid inside its own .lbook/, and the ledger records **where it currently is**.
    // Opening a folder that carries a known uid re-points that entry — which is what
    // "open folder as vault" does for a vault that was moved outside the app.
    const f = fixture()
    const store = f.store()
    const folder = f.inside("BPP")

    expect(store.add(folder, "uid-bpp").outcome).toBe("added")
    expect(store.add(folder, "uid-bpp"), "same folder, same uid").toMatchObject({ outcome: "known" })

    // Same book, a new folder: the entry follows instead of a second row appearing.
    const moved = store.add(f.inside("BPP (moved)"), "uid-bpp")
    expect(moved.outcome).toBe("repointed")
    expect(store.list()).toHaveLength(1)
    expect(store.resolve(store.list()[0]!)).toBe(f.inside("BPP (moved)"))
    // A book that joined the library keeps its place in the order and its added date.
    expect(moved.ref.addedAt).toBe(store.list()[0]?.addedAt)

    // The folder is now a different book (its meta.json was replaced): the folder wins,
    // because the uid is what progress, the cover and every read are keyed by.
    const relabelled = store.add(f.inside("BPP (moved)"), "uid-other")
    expect(relabelled.outcome).toBe("repointed")
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.uid).toBe("uid-other")
  })

  it("re-points across the default location boundary, keeping one spelling each", () => {
    const f = fixture()
    const store = f.store()
    store.add(f.inside("BPP"), "uid-bpp")

    // Moved out of the library folder: recorded absolute, because a relative path would
    // no longer resolve.
    store.add(f.outside("BPP"), "uid-bpp")
    expect(store.list()[0]?.path).toBe(f.outside("BPP"))
    expect(store.resolve(store.list()[0]!)).toBe(f.outside("BPP"))

    // And back in: stored relative again, so the whole library can still be renamed (B7).
    store.add(f.inside("BPP"), "uid-bpp")
    expect(store.list()[0]?.path).toBe("BPP")
  })

  it("forgets an entry without touching the folder", () => {
    // This is A11's promise, and the reason there is no _trash: the app is not
    // allowed to delete a user's book folder, ever.
    const f = fixture()
    const store = f.store()
    const folder = f.inside("BPP")
    fs.writeFileSync(path.join(folder, "book.pdf"), "%PDF-1.4", "utf8")
    const ref = store.add(folder, "uid-bpp").ref

    expect(store.remove(ref)).toBe(true)
    expect(store.list()).toEqual([])
    expect(fs.existsSync(folder)).toBe(true)
    expect(fs.existsSync(path.join(folder, "book.pdf"))).toBe(true)
    expect(store.remove(ref), "removing twice is a no-op").toBe(false)
  })

  it("survives a hand-edited ledger and keeps the entries that still parse", () => {
    const f = fixture()
    fs.mkdirSync(path.dirname(f.file), { recursive: true })
    fs.writeFileSync(
      f.file,
      JSON.stringify({
        version: 1,
        books: [
          { path: "Good Book", uid: "uid-good", addedAt: "2026-01-01T00:00:00.000Z" },
          { path: "Broken Book" },
          { uid: "uid-no-path" },
          "not an object",
          { path: "Dup", uid: "uid-dup", addedAt: "" },
          { path: "Dup", uid: "uid-dup", addedAt: "" },
        ],
      }),
      "utf8",
    )

    const store = f.store()
    expect(store.list().map((ref) => ref.uid)).toEqual(["uid-good", "uid-dup"])
    expect(store.issues).toHaveLength(4) // two incomplete entries, a non-object, and the repeat
  })

  it("starts empty instead of throwing when the file is not JSON at all", () => {
    const f = fixture()
    fs.mkdirSync(path.dirname(f.file), { recursive: true })
    fs.writeFileSync(f.file, "{ not json", "utf8")

    const store = f.store()
    expect(store.list()).toEqual([])
    expect(store.issues[0]).toContain("could not be read")
  })

  it("persists across store instances and writes atomically", () => {
    const f = fixture()
    f.store().add(f.inside("BPP"), "uid-bpp")

    expect(createLedgerStore({ file: f.file, root: f.root }).list()).toHaveLength(1)
    expect(fs.existsSync(`${f.file}.tmp`)).toBe(false)
    // And the on-disk shape is the stable one the plan asks for (B5).
    expect(fs.readFileSync(f.file, "utf8").endsWith("\n")).toBe(true)
  })
})
