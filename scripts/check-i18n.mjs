/**
 * Fails when a user-visible string in the renderer is not behind `t()`.
 *
 * The interface is bilingual (`src/renderer/i18n/`), and the failure mode this
 * guards against is quiet: someone adds a button with `Add a book folder` on it,
 * the English build looks perfect, and the Chinese one shows English. Review does
 * not catch that reliably; a script does.
 *
 * What it looks at:
 *
 *   1. JSX text nodes — `>Some text<`, including the multi-line form where the text
 *      sits on its own line between tags (that is how `Markdown` and `Blocks` were
 *      hidden from the first sweep).
 *   2. The attributes a reader can see: `title`, `placeholder`, `aria-label`, `alt`.
 *
 * What it deliberately ignores:
 *
 *   - `className`, `style`, `data-*`, `key`, `id` and the rest of the structural
 *     attributes — those hold Tailwind classes, not copy.
 *   - Lines that are comments.
 *   - `console.*` output: a diagnostic for whoever debugs the renderer, not something
 *     a reader reads, and `en.ts` says so.
 *   - The brand name, which is the same word in every language.
 *
 * It is a lint, not a parser: the string constants it finds just have to be either
 * inside a `t(...)` call or listed in the allowlist below.
 *
 *   node scripts/check-i18n.mjs
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../src/renderer", import.meta.url))

/** The dictionary itself is where the strings are *supposed* to be literal. */
const SKIP_FILES = new Set([path.join(ROOT, "i18n", "en.ts"), path.join(ROOT, "i18n", "zh-CN.ts")])

/** Text that reads the same in every language. */
const ALLOWED = new Set(["LBook", "PDF", "OCR", "Markdown"])

/** Attributes a reader can see. */
const VISIBLE_ATTRS = ["title", "placeholder", "aria-label", "alt", "label"]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Looks like prose rather than code or a CSS class list. */
function looksLikeCopy(text) {
  const value = text.trim()
  if (value.length < 3) return false
  if (ALLOWED.has(value)) return false
  if (!/[A-Za-z]/.test(value)) return false
  // Code, generics and CSS classes.
  if (/[(){};=<>|&$[\]`\\]/.test(value)) return false
  // An all-lowercase run of words is a Tailwind class list ("flex items-center").
  if (value === value.toLowerCase()) return false
  return true
}

const problems = []

for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(file)) continue
  const source = fs.readFileSync(file, "utf8")

  // Diagnostics are not copy: drop the console calls before looking at anything.
  const withoutConsole = source.replace(/console\.(log|warn|error|info)\([\s\S]*?\)\n/g, "")
  const before = source.slice(0, 0) // (kept explicit: offsets below are in this text)

  const lineOf = (index) => source.slice(0, index).split("\n").length
  const line = (index) => source.slice(0, index).split("\n").length

  // 1. JSX text nodes, single- or multi-line — .tsx only.
  //
  // Not .ts: there is no JSX there, and the pattern cannot tell a type from a tag. It
  // read `=> Promise<UndoOutcome>` as the text between two tags and reported `Promise`
  // as untranslated copy, which is the kind of false positive that gets a lint turned
  // off. `.ts` files still go through the visible-attribute rule below.
  const jsxText = file.endsWith(".tsx") ? withoutConsole : ""
  for (const match of jsxText.matchAll(/>([^<>{}]+)</gs)) {
    const text = match[1]
    if (!looksLikeCopy(text)) continue
    // A text node is reported once per occurrence; the offset inside `withoutConsole`
    // is close enough to name the line in the original file.
    problems.push({ file, line: lineOf(match.index), text: text.trim().replace(/\s+/g, " ") })
  }

  // 2. Visible attributes with a string literal (a `{...}` expression is fine: that is
  //    where `t()` lives).
  for (const attribute of VISIBLE_ATTRS) {
    const pattern = new RegExp(`\\b${attribute}\\s*=\\s*"([^"]{3,})"`, "g")
    for (const match of withoutConsole.matchAll(pattern)) {
      if (!looksLikeCopy(match[1])) continue
      problems.push({ file, line: lineOf(match.index), text: match[1] })
    }
  }

  void before
  void line
}

const relative = (file) => path.relative(process.cwd(), file).replace(/\\/g, "/")

if (problems.length === 0) {
  console.log(`i18n: every user-visible string in ${walk(ROOT).length - SKIP_FILES.size} files goes through t()`)
  process.exit(0)
}

console.error(`i18n: ${problems.length} string(s) are not behind t():\n`)
for (const problem of problems) {
  console.error(`  ${relative(problem.file)}:${problem.line}  ${problem.text}`)
}
console.error(
  "\nPut them in src/renderer/i18n/en.ts and zh-CN.ts (a missing Chinese entry is a\n" +
    "compile error), or add the string to ALLOWED in this script if it reads the same\n" +
    "in every language.",
)
process.exit(1)
