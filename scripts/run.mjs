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
  // Nothing here links a native module any more: the one-time converter that needed
  // better-sqlite3 and yauzl is gone (its output is a book folder, and it lives on in
  // git history).
  external: ["electron", "electron-updater"],
})

const result = spawnSync(process.execPath, [outfile, ...rest], { stdio: "inherit", cwd: root })
process.exit(result.status ?? 0)
