// Relative rather than the renderer's `@shared` alias on purpose: `tsconfig.main.json`
// also compiles `tests/`, and that project has no alias — this file has to be importable
// from a plain Node context, which is what lets the history be tested without a browser.
import type { EditableField } from "../../shared/ipc"

/**
 * What has been corrected in this session, and what it replaced.
 *
 * Editing here has no dirty state and no save button that can be delayed (A20): each save
 * goes straight into `ocr.json`, and this is the memory of it — enough to put one back.
 *
 * **Only the difference is kept.** An entry holds the two strings, not a copy of the file
 * and not a page's bytes: a corrected block is tens of bytes, a page's Markdown a few
 * kilobytes. The stack is bounded per book (there is a limit because a session could
 * otherwise grow without one, not because anyone undoes fifty things by hand).
 *
 * **Per book, because the books are unrelated.** Undoing a correction in one book after
 * opening another would be a surprise, and `writeField` would refuse it anyway.
 *
 * The stack is memory only, and deliberately: after a restart the file may well have been
 * changed by something else, and an "undo" that silently reverts a change the reader never
 * saw in this session is worse than no undo. Every write still goes through the
 * optimistic check, so a stale entry fails instead of overwriting.
 *
 * This module is framework-free (no React, no IPC) so it can be tested directly; the hook
 * and the write live in `src/renderer/hooks/useEditHistory.ts`.
 */
export interface EditEntry {
  /** Stable within a session; what an editor points at to offer its own undo. */
  id: number
  uid: string
  /** 0-based, the file's own numbering (A8). */
  pageIndex: number
  field: EditableField
  /** Only for `block_content`. */
  blockIndex?: number
  /** The text the save replaced. */
  before: string
  /** The text the save wrote — the value a later change must still match. */
  after: string
}

/** Per book. Far more than anyone undoes by hand, and well under a megabyte. */
const LIMIT_PER_BOOK = 50

let nextId = 1
const books = new Map<string, EditEntry[]>()
const listeners = new Set<() => void>()

/** Shared so a book with no history returns one stable value (see `editsOf`). */
const EMPTY: EditEntry[] = []

function emit(): void {
  for (const listener of listeners) listener()
}

/** Subscribes to any change; returns the unsubscribe function. */
export function subscribeEdits(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Remembers a save. Returns the entry so the editor that made it can offer to undo *this*
 * one rather than merely "the last" one.
 */
export function recordEdit(entry: Omit<EditEntry, "id">): EditEntry {
  const full: EditEntry = { ...entry, id: nextId++ }
  const list = books.get(entry.uid) ?? EMPTY
  // A new array, not `push`: React compares snapshots by identity, and mutating in place
  // would look like "nothing changed".
  const next = [...list, full]
  books.set(entry.uid, next.length > LIMIT_PER_BOOK ? next.slice(-LIMIT_PER_BOOK) : next)
  emit()
  return full
}

/**
 * This book's edits, oldest first. The array keeps its identity until something is
 * recorded or forgotten, which is what lets it be read through `useSyncExternalStore`.
 */
export function editsOf(uid: string | undefined): EditEntry[] {
  if (uid === undefined) return EMPTY
  return books.get(uid) ?? EMPTY
}

/** The edit an undo would reverse, or null when there is nothing to undo. */
export function newestEdit(uid: string | undefined): EditEntry | null {
  const list = editsOf(uid)
  return list.length === 0 ? null : (list[list.length - 1] ?? null)
}

/** Drops one entry, once it has been undone or can no longer be applied. */
export function forgetEdit(uid: string, id: number): void {
  const list = books.get(uid)
  if (list === undefined) return
  const next = list.filter((entry) => entry.id !== id)
  if (next.length === list.length) return
  books.set(uid, next)
  emit()
}

/**
 * The opening of an entry's text, for naming it in a tooltip.
 *
 * A page number alone is not enough once a page has two corrections on it, and a block
 * index means nothing to a reader (the interface never shows block numbers). The first
 * few characters of what was written say far more — and they are already in hand.
 */
export function snippetOf(text: string, limit = 18): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

/** Empties the history — for tests, and for anything that has to start clean. */
export function resetEditHistory(): void {
  books.clear()
  nextId = 1
  emit()
}
