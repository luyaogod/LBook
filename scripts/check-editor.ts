/**
 * Verifies the source editor in a real Electron window under the production protocol and
 * policy.
 *
 *   npm run check:editor
 *
 * It serves `out/spike` over `app://bundle` with the *same* handler and the *same* CSP the
 * app installs (`src/main/bundleHost.ts`), loads the check page, and prints what the page
 * found. It also prints what lazy loading actually bought: the entry chunk of the app, next
 * to the editor's own chunks.
 *
 * Why this is a program and not a note: an editor can be wired correctly in development and
 * still arrive as an empty box in the packaged app — a blocked stylesheet, a chunk under a
 * different origin, a policy that forbids what the library needs. All three are properties
 * of this Electron version, this bundle and this policy, and all three change without the
 * editor's code changing.
 */
import { app, BrowserWindow, session } from "electron"
import fs from "node:fs"
import path from "node:path"
import { applyContentSecurityPolicy, registerBundleProtocol, registerShellSchemes } from "../src/main/bundleHost"

// Must happen before app.whenReady(), exactly as in the app.
registerShellSchemes()

// This file is bundled to `out/scripts/check-editor.cjs`, so `__dirname` is
// `<root>/out/scripts`: one level up is `out/`, which holds both bundles.
const SPIKE_DIR = path.join(__dirname, "..", "spike")
const APP_DIR = path.join(__dirname, "..", "renderer")
const SPIKE_URL = "app://bundle/index.html"
const TIMEOUT_MS = 30_000

interface SpikeResult {
  ok: boolean
  ms: number
  checks: Array<{ what: string; ok: boolean; detail?: string }>
  errors: string[]
  cspViolations: string[]
}

declare global {
  interface Window {
    __editorSpike?: SpikeResult
  }
}

/** Sizes of a built bundle's chunks, largest first. */
function assetSizes(dir: string): Array<{ name: string; kb: number }> {
  const assets = path.join(dir, "assets")
  if (!fs.existsSync(assets)) return []
  return fs
    .readdirSync(assets)
    .map((name) => ({ name, kb: Math.round(fs.statSync(path.join(assets, name)).size / 1024) }))
    .sort((a, b) => b.kb - a.kb)
}

/** What a build's entry costs: the scripts its index.html names. */
function entrySizeOf(dir: string): number {
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8")
  const scripts = [...html.matchAll(/src="\.\/([^"]+\.js)"/g)].map((match) => match[1] ?? "")
  return scripts.reduce((total, relative) => {
    const file = path.join(dir, relative)
    return total + (fs.existsSync(file) ? Math.round(fs.statSync(file).size / 1024) : 0)
  }, 0)
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(SPIKE_DIR, "index.html"))) {
    // `app.exit`, never `process.exitCode`: Electron keeps running with no window open,
    // so a check that only sets an exit code hangs forever and reads as a stuck tool.
    console.error(`${SPIKE_DIR}/index.html is missing — the npm script builds it first`)
    app.exit(1)
    return
  }

  await app.whenReady()
  applyContentSecurityPolicy()

  // One window, hidden: the checks are read back from the page, not looked at.
  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })

  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.log(`  [renderer] ${message}`)
  })
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`the window failed to load ${url}: ${description} (${code})`)
    process.exitCode = 1
  })

  registerBundleProtocol(SPIKE_DIR)
  await win.loadURL(SPIKE_URL)

  const deadline = Date.now() + TIMEOUT_MS
  let result: SpikeResult | null = null
  while (Date.now() < deadline) {
    result = (await win.webContents.executeJavaScript("window.__editorSpike ?? null")) as SpikeResult | null
    if (result) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  session.defaultSession.flushStorageData()
  win.destroy()

  if (!result) {
    console.error(`the check never reported back within ${TIMEOUT_MS}ms`)
    process.exitCode = 1
    app.exit(1)
    return
  }

  let failed = 0
  for (const check of result.checks) {
    if (!check.ok) failed++
    console.log(`  ${check.ok ? "✓" : "✗"} ${check.what}${check.detail === undefined ? "" : `  — ${check.detail}`}`)
  }
  for (const violation of result.cspViolations) console.log(`  ✗ CSP blocked ${violation}`)
  for (const error of result.errors) console.log(`  ✗ ${error}`)

  console.log(`\n  ${result.ok ? "ok" : "FAILED"} in ${result.ms}ms`)
  if (fs.existsSync(path.join(APP_DIR, "index.html"))) {
    console.log(`  app entry chunk (paid on every launch): ${entrySizeOf(APP_DIR)} KB`)
  }
  console.log(`  check page entry: ${entrySizeOf(SPIKE_DIR)} KB`)
  for (const asset of assetSizes(SPIKE_DIR).slice(0, 6)) {
    console.log(`  ${String(asset.kb).padStart(6)} KB  ${asset.name}`)
  }

  // `app.exit`, not `process.exitCode`: Electron keeps running with a hidden window gone,
  // and a check that never returns looks exactly like a hang.
  app.exit(failed > 0 || result.cspViolations.length > 0 || result.errors.length > 0 ? 1 : 0)
}

void main().catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})
