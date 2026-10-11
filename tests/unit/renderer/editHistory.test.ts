import { afterEach, describe, expect, it, vi } from "vitest"
import {
  editsOf,
  forgetEdit,
  newestEdit,
  recordEdit,
  resetEditHistory,
  snippetOf,
  subscribeEdits,
} from "../../../src/renderer/lib/editHistory"

/**
 * The session's correction history: what an undo goes through.
 *
 * The two properties worth a test are easy to get wrong and hard to see:
 *
 *  - **Snapshots keep their identity when nothing changed.** It is read through
 *    `useSyncExternalStore`, which compares by identity; a snapshot that is a fresh
 *    array each call re-renders forever. So the empty case must hand back one shared
 *    array, and a no-op must not replace anything.
 *  - **A change does replace the array** rather than pushing into it, or React would
 *    never see the change at all.
 */

const BOOK = "uid-bpp"
const OTHER = "uid-oxford"

function edit(uid: string, overrides: Partial<Parameters<typeof recordEdit>[0]> = {}) {
  return recordEdit({
    uid,
    pageIndex: 300,
    field: "block_content",
    blockIndex: 0,
    before: "old text",
    after: "new text",
    ...overrides,
  })
}

afterEach(() => {
  resetEditHistory()
})

describe("editHistory", () => {
  it("returns the entry it recorded, with an id an editor can point at", () => {
    const first = edit(BOOK)
    const second = edit(BOOK, { blockIndex: 3 })

    expect(first.id).toBeGreaterThan(0)
    expect(second.id).not.toBe(first.id)
    expect(editsOf(BOOK).map((entry) => entry.id)).toEqual([first.id, second.id])
    expect(first).toMatchObject({ uid: BOOK, pageIndex: 300, field: "block_content", before: "old text" })
  })

  it("keeps only the difference, verbatim", () => {
    // Multi-byte text, newlines and quotes survive: an undo puts back exactly what was
    // there, so nothing may be normalised on the way in.
    const before = "第一行\n\"引号\" 与 \\ 反斜杠"
    const after = "改过的一段\n\n| 表格 |"
    edit(BOOK, { field: "markdown", blockIndex: undefined, before, after })

    const [entry] = editsOf(BOOK)
    expect(entry?.before).toBe(before)
    expect(entry?.after).toBe(after)
    // No copy of the file, no page bytes: just the two strings.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "after",
      "before",
      "blockIndex",
      "field",
      "id",
      "pageIndex",
      "uid",
    ])
  })

  it("keeps one history per book", () => {
    edit(BOOK)
    edit(OTHER)

    expect(editsOf(BOOK)).toHaveLength(1)
    expect(editsOf(OTHER)).toHaveLength(1)
    expect(newestEdit(BOOK)?.uid).toBe(BOOK)
  })

  it("has nothing to undo when there is no history", () => {
    expect(newestEdit(BOOK)).toBeNull()
    expect(editsOf(undefined)).toEqual([])
  })

  it("hands back a stable snapshot while nothing changes", () => {
    // Two calls, same array: otherwise `useSyncExternalStore` re-renders in a loop.
    expect(editsOf("uid-unknown")).toBe(editsOf("uid-unknown"))
    expect(editsOf(undefined)).toBe(editsOf("uid-unknown"))

    edit(BOOK)
    const snapshot = editsOf(BOOK)
    expect(editsOf(BOOK)).toBe(snapshot)
    // Reading another book does not disturb this one's snapshot.
    expect(editsOf(OTHER)).not.toBe(snapshot)
  })

  it("replaces the snapshot when something is recorded", () => {
    const empty = editsOf(BOOK)
    edit(BOOK)
    expect(editsOf(BOOK)).not.toBe(empty)
  })

  it("names the newest edit, which is what an undo reverses", () => {
    edit(BOOK, { after: "first" })
    const last = edit(BOOK, { after: "second" })

    expect(newestEdit(BOOK)?.id).toBe(last.id)
    expect(newestEdit(BOOK)?.after).toBe("second")
  })

  it("forgets one entry, and leaves the rest alone", () => {
    const first = edit(BOOK)
    const second = edit(BOOK, { blockIndex: 2 })

    forgetEdit(BOOK, first.id)

    expect(editsOf(BOOK).map((entry) => entry.id)).toEqual([second.id])
    // Forgetting the other book's id does nothing at all.
    forgetEdit(OTHER, second.id)
    expect(editsOf(BOOK)).toHaveLength(1)
  })

  it("does not disturb the snapshot when there is nothing to forget", () => {
    const second = edit(BOOK)
    const snapshot = editsOf(BOOK)

    forgetEdit(BOOK, 99999) // never recorded
    expect(editsOf(BOOK)).toBe(snapshot)

    forgetEdit(BOOK, second.id)
    expect(editsOf(BOOK)).not.toBe(snapshot)
  })

  it("bounds the history, dropping the oldest first", () => {
    // The limit exists so a long session cannot grow without one; keeping the newest is
    // what matters, since an undo goes backwards from the end.
    for (let index = 0; index < 55; index++) edit(BOOK, { after: `edit ${index}` })

    const list = editsOf(BOOK)
    expect(list).toHaveLength(50)
    expect(list[0]?.after).toBe("edit 5")
    expect(list[list.length - 1]?.after).toBe("edit 54")
  })

  it("tells its listeners about a change, and stops when they leave", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeEdits(listener)

    const entry = edit(BOOK)
    expect(listener).toHaveBeenCalledTimes(1)

    forgetEdit(BOOK, entry.id)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    edit(BOOK)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe("snippetOf", () => {
  it("collapses whitespace so a tooltip stays one line", () => {
    expect(snippetOf("a\n\n  b\tc")).toBe("a b c")
  })

  it("clips at the limit, and says so", () => {
    expect(snippetOf("短", 18)).toBe("短")
    expect(snippetOf("0123456789", 4)).toBe("0123…")
    expect(snippetOf("  ", 4)).toBe("")
  })
})
