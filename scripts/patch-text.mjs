/**
 * Applies plain-text patches to files, so the patch itself needs no escaping.
 *
 * The problem it exists for: editing Chinese documentation from a script means writing
 * strings that contain both ASCII quotes and backticks (code spans). In a JavaScript
 * source string one of those always has to be escaped, and forgetting it looks like a
 * syntax error at best and a mangled document at worst.
 *
 * Format — a marker must sit alone on its line; everything between markers is taken
 * literally, including blank lines:
 *
 *   @=FILE=
 *   docs/example.md
 *   @=OLD=
 *   the exact text that is there now
 *   @=NEW=
 *   what it becomes
 *   @=OLD=
 *   a second piece in the same file
 *   @=NEW=
 *   ...
 *
 *   @=FILE=
 *   docs/another.md
 *   ...
 *
 * Only the **first** occurrence of an anchor is replaced: a document that repeats a phrase
 * is normal, and replacing every occurrence is how a patch turns into a rewrite.
 *
 * Each file is all-or-nothing: if one anchor is missing, that file is left exactly as it
 * was and the run exits non-zero. A half-applied document is worse than an unapplied one,
 * and a patch that quietly does nothing is worse than both.
 *
 *   node scripts/patch-text.mjs <job-file>
 */
import fs from "node:fs"

const FILE = "@=FILE="
const OLD = "@=OLD="
const NEW = "@=NEW="

/** Reads the job file into `[{ path, jobs: [[old, new], ...] }]`. */
export function parseJobs(text) {
  const files = []
  let file = null
  let mode = null
  let buffer = []
  let pendingOld = null

  /** Closes the `@=NEW=` block being collected, if there is one. */
  const close = () => {
    if (mode === "new" && pendingOld !== null && file !== null) {
      file.jobs.push([pendingOld, buffer.join("\n")])
    }
    pendingOld = null
    buffer = []
  }

  for (const line of text.split("\n")) {
    const marker = line.trim()

    if (marker === FILE) {
      close()
      if (file !== null) files.push(file)
      file = { path: null, jobs: [] }
      mode = "path"
      continue
    }
    if (file === null) continue

    if (marker === OLD) {
      close()
      mode = "old"
      continue
    }
    if (marker === NEW) {
      pendingOld = buffer.join("\n")
      // The buffer must be emptied here: it still holds the OLD text, and leaving it
      // would make the replacement "OLD + newline + NEW". That is not a syntax error and
      // not a crash — it silently duplicated a dictionary key and split a table row in
      // two before this line existed, which is exactly why the tool has a test.
      buffer = []
      mode = "new"
      continue
    }

    if (mode === "path") {
      if (line.trim() !== "" && file.path === null) file.path = line.trim()
      continue
    }
    buffer.push(line)
  }

  close()
  if (file !== null) files.push(file)
  return files
}

export function applyJobs(path, jobs) {
  const source = fs.readFileSync(path, "utf8")
  const missing = jobs.filter(([from]) => !source.includes(from)).map(([from]) => from)
  if (missing.length > 0) return { applied: 0, missing }

  let out = source
  for (const [from, to] of jobs) {
    const at = out.indexOf(from)
    out = out.slice(0, at) + to + out.slice(at + from.length)
  }
  fs.writeFileSync(path, out)
  return { applied: jobs.length, missing: [] }
}

function main() {
  const jobFile = process.argv[2]
  if (!jobFile) {
    console.error("usage: node scripts/patch-text.mjs <job-file>")
    process.exit(1)
  }

  let applied = 0
  let missing = 0
  for (const file of parseJobs(fs.readFileSync(jobFile, "utf8"))) {
    if (file.path === null || file.jobs.length === 0) continue
    const result = applyJobs(file.path, file.jobs)
    applied += result.applied
    for (const anchor of result.missing) {
      console.error(`MISSING in ${file.path}: ${JSON.stringify(anchor.slice(0, 100))}`)
      missing++
    }
  }

  console.log(`${applied} replacement(s) applied, ${missing} missing`)
  process.exit(missing === 0 ? 0 : 1)
}

// Only run when invoked directly, so a test can import the two functions above.
if (process.argv[1] !== undefined && process.argv[1].endsWith("patch-text.mjs")) main()
