/**
 * Builds the Electron main process and preload script with esbuild.
 *
 * We deliberately do NOT use electron-vite: its peer range (vite ^5||^6||^7)
 * conflicts with @vitejs/plugin-react@6 (vite ^8). See DESIGN.md.
 *
 * Output is CommonJS because a sandboxed preload script must be CJS.
 *
 * Run directly:  node scripts/build.mjs [--watch]
 */
import { build, context } from "esbuild"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

/** Native or Electron-provided modules must never be bundled. */
const EXTERNAL = ["electron", "better-sqlite3", "yauzl", "yazl", "electron-updater"]

const TARGETS = [
  { name: "main", entry: "src/main/index.ts", outfile: "out/main/index.cjs" },
  { name: "preload", entry: "src/preload/index.ts", outfile: "out/preload/index.cjs" },
]

/**
 * @param {{ watch?: boolean, onRebuild?: (target: string) => void }} [options]
 */
export async function buildAll({ watch = false, onRebuild } = {}) {
  for (const target of TARGETS) {
    const options = {
      entryPoints: [path.join(root, target.entry)],
      outfile: path.join(root, target.outfile),
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      sourcemap: true,
      external: EXTERNAL,
      logLevel: watch ? "warning" : "info",
    }

    if (!watch) {
      await build(options)
      continue
    }

    if (onRebuild) {
      options.plugins = [
        {
          name: "lbook-notify",
          setup(buildApi) {
            buildApi.onEnd(() => onRebuild(target.name))
          },
        },
      ]
    }

    const ctx = await context(options)
    await ctx.watch()
  }
}

// Only run as a CLI when invoked directly, so dev.mjs can import buildAll.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildAll({ watch: process.argv.includes("--watch") })
}
