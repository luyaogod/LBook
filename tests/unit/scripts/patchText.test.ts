import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

/**
 * The documentation patcher, tested through its command line.
 *
 * It earns a test because of how it fails: silently. Its first version applied only the
 * last file of a multi-file job file and reported success, which quietly dropped two
 * dictionary entries — a *document* losing text is hard to notice, and the tool exists
 * precisely to be trusted with text nobody wants to re-read.
 *
 * So: every file in the job is patched, and any missing anchor leaves that file untouched
 * and the run non-zero. (`docs/` is not the only user — `AGENTS.md` has the same rule for
 * comments, and the same quoting problem while writing them.)
 */

const TOOL = path.resolve("scripts/patch-text.mjs")
let dir: string | undefined

afterEach(() => {
  if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function fixture(
  files: Record<string, string>,
  job: string,
): { dir: string; read: (name: string) => string } {
  // A local binding as well as the module one: `dir` is `string | undefined` for the
  // cleanup hook, and joining a path with that is a type error (and a real crash).
  const created = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-patch-"))
  dir = created
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(created, name), content, "utf8")
  }
  fs.writeFileSync(path.join(created, "job.txt"), job, "utf8")
  return {
    dir: created,
    read: (name) => fs.readFileSync(path.join(created, name), "utf8"),
  }
}


function run(dir: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(process.execPath, [TOOL, path.join(dir, "job.txt")], { cwd: dir, encoding: "utf8" })
    return { ok: true, output }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

describe("patch-text", () => {
  it("patches every file in one job, in order", () => {
    const f = fixture(
      { "a.md": "one\ntwo\n", "b.md": "three\n" },
      [
        "@=FILE=",
        "a.md",
        "@=OLD=",
        "one",
        "@=NEW=",
        "ONE",
        "@=OLD=",
        "two",
        "@=NEW=",
        "TWO",
        "@=FILE=",
        "b.md",
        "@=OLD=",
        "three",
        "@=NEW=",
        "THREE",
      ].join("\n"),
    )

    const result = run(f.dir)
    expect(result.ok).toBe(true)
    expect(result.output).toMatch(/3 replacement\(s\) applied/)
    expect(f.read("a.md")).toBe("ONE\nTWO\n")
    expect(f.read("b.md")).toBe("THREE\n")
  })

  it("takes content literally: quotes, backticks and blank lines survive", () => {
    // The whole reason the tool exists: this is the text that is painful to hold in a
    // JavaScript string, and it must come out byte for byte.
    // Written with a template literal on purpose: this is the escaping the tool exists to
    // avoid, so the test should *contain* the awkward characters rather than fight them.
    const body = `他说:"这样"。

用 \`npm run x\` 检查 "引号"。`
    const f = fixture(
      { "doc.md": "before\n" },
      ["@=FILE=", "doc.md", "@=OLD=", "before", "@=NEW=", body].join("\n"),
    )

    expect(run(f.dir).ok).toBe(true)
    expect(f.read("doc.md")).toBe(`${body}\n`)

  })

  it("matches a CRLF file, and keeps its line endings", () => {
    // The failure this covers is silent: a job file written by a heredoc has LF, a file git
    // checked out on Windows has CRLF, and a plain `includes` between the two finds nothing —
    // so the patch "applies" nothing and nobody notices until a document is missing text.
    const f = fixture({}, "")
    const target = path.join(f.dir, "crlf.md")
    fs.writeFileSync(target, "alpha\r\nbeta\r\n", "utf8")
    fs.writeFileSync(
      path.join(f.dir, "job.txt"),
      ["@=FILE=", "crlf.md", "@=OLD=", "alpha", "@=NEW=", "ALPHA", "@=OLD=", "beta", "@=NEW=", "BETA"].join("\n"),
      "utf8",
    )

    expect(run(f.dir).ok).toBe(true)
    expect(fs.readFileSync(target, "utf8")).toBe("ALPHA\r\nBETA\r\n")
  })

  it("leaves a file alone when an anchor is missing, and says so", () => {

    const original = "alpha\nbeta\n"
    const f = fixture(
      { "doc.md": original },
      ["@=FILE=", "doc.md", "@=OLD=", "alpha", "@=NEW=", "ALPHA", "@=OLD=", "not in the file", "@=NEW=", "x"].join("\n"),
    )

    const result = run(f.dir)
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/MISSING in doc\.md/)
    // All-or-nothing: the first anchor matched, and the file is still untouched.
    expect(f.read("doc.md")).toBe(original)
  })
})
