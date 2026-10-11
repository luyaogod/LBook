import { useCallback, useSyncExternalStore } from "react"
import { writeField } from "@/api/pdfs"
import { editsOf, forgetEdit, subscribeEdits, type EditEntry } from "@/lib/editHistory"

/**
 * The session's correction history for one book, and the one way to undo an entry.
 *
 * Undoing is a write like any other: it puts the old text back and passes the text it is
 * replacing as `baseValue`, so an entry whose field has changed since (someone edited the
 * file outside the app, or this entry was already undone) is **refused** rather than
 * quietly reverted. A refusal keeps the entry on the stack: the reader can look, and
 * nothing is lost by leaving it there.
 *
 * Kept apart from `lib/editHistory.ts` so that file stays free of React and IPC and can be
 * tested on its own.
 */
export interface UndoOutcome {
  ok: boolean
  /** Present on failure: our own message as a translation key, and the English text. */
  code?: string
  error?: string
}

export function useEditHistory(uid: string | undefined): {
  entries: EditEntry[]
  undo: (entry: EditEntry) => Promise<UndoOutcome>
} {
  const entries = useSyncExternalStore(subscribeEdits, () => editsOf(uid))

  const undo = useCallback(
    async (entry: EditEntry): Promise<UndoOutcome> => {
      const outcome = await writeField({
        uid: entry.uid,
        // 0-based, the file's own numbering (A8) — the entry stored it that way.
        pageIndex: entry.pageIndex,
        field: entry.field,
        blockIndex: entry.blockIndex,
        value: entry.before,
        baseValue: entry.after,
      })

      if (!outcome.ok) return { ok: false, code: outcome.code, error: outcome.error }

      forgetEdit(entry.uid, entry.id)
      return { ok: true }
    },
    [],
  )

  return { entries, undo }
}

/**
 * Names one entry for a tooltip: which field, on which page, and which text.
 *
 * The page number alone stops being enough as soon as a page has two corrections on it,
 * and the snippet is what tells them apart — it is the text now in the file, so it is the
 * correction the reader would be putting back.
 */
export function describeEntry(
  entry: EditEntry,
  t: (key: never, options: Record<string, unknown>) => string,
  snippet: string,
): string {
  const page = entry.pageIndex + 1
  const what =
    entry.field === "markdown" ? t("undo.markdown" as never, { page }) : t("undo.block" as never, { page })
  // A snippet that is empty (a field corrected to nothing) leaves just the field name.
  return snippet === "" ? what : `${what} (${snippet})`
}
