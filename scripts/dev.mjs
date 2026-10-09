/**
 * Development runner: Vite dev server + esbuild watch + Electron.
 *
 * Electron is restarted automatically when the main process or preload rebuilds.
 * Renderer edits are hot-reloaded by Vite and need no restart.
 */
import { spawn } from "node:child_process"
import electronPath from "electron"
import { createServer } from "vite"
import { buildAll } from "./build.mjs"

const DEV_URL = process.env.LBOOK_DEV_SERVER_URL ?? "http://localhost:5173"

let electron = null
let shuttingDown = false
let restartTimer = null

// esbuild fires onEnd for the initial build too. The first notification per
// target is the initial one; only later ones mean the file actually changed.
const initialBuildSeen = new Set()

function startElectron() {
  if (shuttingDown) return

  electron?.kill()
  electron = spawn(electronPath, ["."], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, LBOOK_DEV_SERVER_URL: DEV_URL },
  })

  electron.on("exit", (code) => {
    if (shuttingDown) return
    // Electron exiting on its own is the user closing the window: stop everything.
    console.log(`[dev] electron exited (${code ?? 0}), shutting down`)
    shutdown()
  })
}

function scheduleRestart(reason) {
  if (shuttingDown || !electron) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    console.log(`[dev] restarting electron (${reason})`)
    startElectron()
  }, 200)
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)
  electron?.kill()
  server?.close().finally(() => process.exit(0))
}

const server = await createServer({ server: { port: 5173, strictPort: true } })
await server.listen()
server.printUrls()

await buildAll({
  watch: true,
  onRebuild: (target) => {
    if (!initialBuildSeen.has(target)) {
      initialBuildSeen.add(target)
      return
    }
    scheduleRestart(`${target} rebuilt`)
  },
})

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

startElectron()
