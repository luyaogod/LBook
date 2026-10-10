/**
 * Runs one of the TypeScript maintenance scripts in this folder.
 *
 *   node scripts/run.mjs <script-name> [args...]
 *
 * The scripts import the same modules the main process does, so they are
 * bundled to CJS with the native/Electron modules left external.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("..", import.meta.url))
const [name, ...rest] = process.argv.slice(2)

if (!name) {
  console.error("usage: node scripts/run.mjs <script-name> [args...]")
  process.exit(1)
}

const outfile = path.join(root, "out", "scripts", `${name}.cjs`)

await build({
  entryPoints: [path.join(root, "scripts", `${name}.ts`)],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  logLevel: "warning",
  // The maintenance scripts do use better-sqlite3 and yauzl (the one-time
  // converter reads the old database and the old packages), so they stay external
  // here even though the app itself no longer links them.
  external: ["electron", "better-sqlite3", "yauzl", "electron-updater"],
})

const result = spawnSync(process.execPath, [outfile, ...rest], { stdio: "inherit", cwd: root })
process.exit(result.status ?? 0)
