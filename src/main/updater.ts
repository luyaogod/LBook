import { app } from "electron"
import electronUpdater from "electron-updater"

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | { state: "unsupported" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }

export interface Updater {
  getState(): UpdateStatus
  check(): Promise<UpdateStatus>
  install(): void
  onChange(listener: (status: UpdateStatus) => void): () => void
  /** Starts the periodic background check. No-op in development. */
  start(): void
}

/** electron-updater errors can span dozens of lines; keep only the summary. */
function firstLine(message: string): string {
  return message.split("\n")[0].trim()
}

/** How long after launch the first check runs, so startup is never blocked. */
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function createUpdater(options: { autoCheck: () => boolean }): Updater {
  const listeners = new Set<(status: UpdateStatus) => void>()
  let status: UpdateStatus = app.isPackaged ? { state: "idle" } : { state: "unsupported" }
  let timer: NodeJS.Timeout | null = null

  function setStatus(next: UpdateStatus): void {
    status = next
    for (const listener of listeners) listener(next)
  }

  if (app.isPackaged) {
    // Download silently; the user is only asked to restart once it is ready.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    // electron-updater's own logger dumps full response bodies and headers on
    // any failure. A misconfigured release feed is not worth that noise.
    autoUpdater.logger = null

    autoUpdater.on("checking-for-update", () => setStatus({ state: "checking" }))
    autoUpdater.on("update-available", (info) =>
      setStatus({ state: "available", version: info.version }),
    )
    autoUpdater.on("update-not-available", () => setStatus({ state: "idle" }))
    autoUpdater.on("download-progress", (progress) =>
      setStatus({ state: "downloading", percent: Math.round(progress.percent) }),
    )
    autoUpdater.on("update-downloaded", (info) =>
      setStatus({ state: "ready", version: info.version }),
    )
    autoUpdater.on("error", (error) => {
      // An offline machine must never look like a crash. Only the first line is
      // logged; electron-updater's messages can carry entire HTTP responses.
      console.warn("[updater]", firstLine(error.message))
      setStatus({ state: "error", message: firstLine(error.message) })
    })
  }

  async function runCheck(): Promise<void> {
    if (!app.isPackaged) return
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      // The "error" event usually fires too; this only covers the case where the
      // promise rejects without emitting, so it must not log a second time.
      const message = firstLine(error instanceof Error ? error.message : String(error))
      if (status.state !== "error") setStatus({ state: "error", message })
    }
  }

  function scheduleNext(delay: number): void {
    timer = setTimeout(() => {
      if (options.autoCheck()) void runCheck()
      scheduleNext(CHECK_INTERVAL_MS)
    }, delay)
    timer.unref?.()
  }

  return {
    getState: () => status,

    async check() {
      await runCheck()
      return status
    },

    install() {
      if (!app.isPackaged) return
      autoUpdater.quitAndInstall()
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start() {
      if (!app.isPackaged || timer) return
      scheduleNext(FIRST_CHECK_DELAY_MS)
    },
  }
}
