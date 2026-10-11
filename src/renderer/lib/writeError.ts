/**
 * Turns a failed write into text the reader can read.
 *
 * Our own failure messages travel as a translation key beside the English text
 * (`WriteOutcome.code`), so a reader in Chinese reads a Chinese sentence. A vendor's or
 * the filesystem's wording does not travel that way and is shown exactly as it came —
 * that is I6, recorded in `.agents/plan/05-i18n.md`: we do not put words in a vendor's
 * mouth, and a raw `fs` error is more useful than a guess at what it meant.
 *
 * One function for all of them, because the rule is the same everywhere and the three
 * editors would otherwise each reimplement it.
 */
export function writeErrorText(
  t: (key: never, options: Record<string, unknown>) => string,
  failure: { error: string; code?: string; detail?: string },
): string {
  if (failure.code === undefined) return failure.error
  // `detail` is what a message may name; `{{name}}` is how the dictionaries spell it, so
  // the caller does not have to know which sentence arrived.
  return t(failure.code as never, {
    defaultValue: failure.error,
    ...(failure.detail === undefined ? {} : { name: failure.detail }),
  })
}
