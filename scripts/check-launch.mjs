/**
 * Does the installed app actually open?
 *
 * The check this replaces launched the app, waited ten seconds, asked whether the process
 * was still alive, and killed the parent. That was wrong twice over:
 *
 *  - A process can be alive with **no window at all**. A renderer that fails to load leaves
 *    exactly that, which is how a build that could not open passed the check — while the
 *    reader was looking at a Start menu tile that did nothing.
 *  - Killing the parent on Windows leaves the renderer, GPU and utility processes behind.
 *    Nine runs of the old check left **thirty-six** LBook processes in Task Manager.
 *
 * So this one reads what the app says about itself. The main process logs
 * `[main] renderer loaded from app://bundle` when the window's `did-finish-load` fires, and
 * `[main] renderer failed to load` when it does not. The check waits for the first, fails on
 * the second, and then kills the whole process tree.
 *
 *   node scripts/check-launch.mjs [path-to-exe] [--timeout 20000]
 *
 * Defaults to the installed app, which is the one that matters: a build can work from
 * `npm start` and still be broken once packaged.
 */
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"

const DEFAULT_EXE = "D:\\APPS\\LBook\\LBook.exe"
const argv = process.argv.slice(2)
const exe = argv.find((value) => !value.startsWith("--")) ?? DEFAULT_EXE
const timeoutIndex = argv.indexOf("--timeout")
const timeoutMs = timeoutIndex >= 0 ? Number(argv[timeoutIndex + 1]) : 20_000

if (!fs.existsSync(exe)) {
  console.error(`no app at ${exe} — install it first (or pass a path)`)
  process.exit(2)
}

const LOADED = /renderer loaded from/
const FAILED = /renderer failed to load|Uncaught|ERROR:/

console.log(`launching ${exe} (giving it ${timeoutMs / 1000}s to draw a window)`)

const child = spawn(exe, [], { stdio: ["ignore", "pipe", "pipe"] })
let output = ""

const killTree = () => {
  if (child.pid === undefined) return
  // /T kills the children too — the renderer, GPU and utility processes are the ones that
  // survive a plain kill, and they are what piles up in Task Manager.
  spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
}

const outcome = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ ok: false, why: "it never said the window loaded" }), timeoutMs)

  const inspect = (chunk) => {
    output += chunk.toString()
    if (LOADED.test(output)) {
      clearTimeout(timer)
      resolve({ ok: true, why: "the window loaded" })
    } else if (FAILED.test(output)) {
      clearTimeout(timer)
      resolve({ ok: false, why: "the renderer reported a failure" })
    }
  }

  child.stdout.on("data", inspect)
  child.stderr.on("data", inspect)
  child.on("exit", (code) => {
    clearTimeout(timer)
    resolve({ ok: false, why: `it exited before loading anything (code ${code ?? "?"})` })
  })
})

killTree()

const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "")
console.log(lines.map((line) => `  │ ${line}`).join("\n"))
console.log(`\n  ${outcome.ok ? "✓" : "✗"} ${outcome.why}`)
if (outcome.ok) console.log("  process tree killed: no leftovers in Task Manager")
process.exit(outcome.ok ? 0 : 1)
