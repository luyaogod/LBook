import { app, BrowserWindow, Menu, nativeTheme, net, protocol, session } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { WINDOW_MAXIMIZED_EVENT } from "../shared/ipc"
import { createAppContext, type AppContext } from "./context"
import { registerIpcHandlers } from "./ipc/register"
import { registerLbookProtocol } from "./protocol/lbookProtocol"
import { applyNativeTheme, paintWindow, windowColors } from "./theme"
import { createUpdater } from "./updater"

/**
 * Schemes must be registered before app.whenReady().
 *
 * `app://bundle/...` serves the built renderer. We cannot load it over `file://`:
 * that origin is opaque, so `new Worker(file://...)` is rejected and pdf.js
 * silently falls back to parsing PDFs on the main thread.
 *
 * `lbook://` serves package entries the DOM loads by URL (`<img src>`).
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
  {
    scheme: "lbook",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

// LBOOK_USE_BUNDLE=1 exercises the production app:// path without packaging.
const isDev = !app.isPackaged && process.env.LBOOK_USE_BUNDLE !== "1"
const DEV_SERVER_URL = process.env.LBOOK_DEV_SERVER_URL ?? "http://localhost:5173"

// out/main/index.cjs -> out/renderer
const RENDERER_DIR = path.join(__dirname, "..", "renderer")

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: lbook:",
  // Speech comes back from the main process as bytes and is played from a Blob
  // URL; without this line `default-src 'none'` blocks it and the audio element
  // only reports the useless "no supported source was found".
  "media-src 'self' blob:",
  "connect-src 'self' lbook:",
  "worker-src 'self'",
].join("; ")

let context: AppContext | null = null

function registerAppProtocol(): void {
  protocol.handle("app", async (request) => {
    const { host, pathname } = new URL(request.url)
    if (host !== "bundle") {
      return new Response("Not found", { status: 404 })
    }

    const relative = pathname === "/" ? "/index.html" : pathname
    const absolute = path.join(RENDERER_DIR, path.normalize(relative))

    // Guard against path traversal escaping the bundle directory.
    if (absolute !== RENDERER_DIR && !absolute.startsWith(RENDERER_DIR + path.sep)) {
      return new Response("Forbidden", { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(absolute).toString())
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })
}

/**
 * Production-only. `script-src` deliberately excludes 'unsafe-inline' and
 * `img-src` excludes remote hosts: OCR block content is rendered through
 * rehype-raw and dangerouslySetInnerHTML, so `<img src=x onerror=...>` is a
 * live XSS path that the CSP must close.
 */
function applyContentSecurityPolicy(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [PRODUCTION_CSP],
      },
    })
  })
}

async function createWindow(): Promise<void> {
  // The renderer's theme is decided before this point (see applyNativeTheme), so
  // the window can be born in the right colours instead of flashing white.
  const theme = context?.config.theme ?? "system"
  const colors = windowColors(theme)

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: colors.background,
    // No OS title bar: the app draws its own top row. The window controls are
    // drawn there too (see AppHeader) rather than left to Windows, so all three
    // share one colour and sit on the header's own background — the native
    // `titleBarOverlay` paints its own strip (a different colour) and hovers the
    // close button in the system red while the other two stay grey.
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once("ready-to-show", () => win.show())

  // The maximize button is drawn by the renderer, so it has to be told when the
  // window changes state by other means too (double-click on the drag region,
  // Win+Up, dragging to the top edge).
  const sendMaximized = () => win.webContents.send(WINDOW_MAXIMIZED_EVENT, win.isMaximized())
  win.on("maximize", sendMaximized)
  win.on("unmaximize", sendMaximized)

  win.webContents.on("did-finish-load", () => {
    console.log(`[main] renderer loaded from ${isDev ? "dev server" : "app://bundle"}`)
  })
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[main] renderer failed to load (${code} ${description}) ${url}`)
  })

  if (isDev) {
    await win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    await win.loadURL("app://bundle/index.html")
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.luyao.lbook")

  // The app has no menu commands of its own. Electron's default template would
  // only add a File/Edit/View/Window bar whose entries either do nothing useful
  // here or duplicate shortcuts the renderer already owns (Ctrl+S is handled in
  // App.tsx), so the whole menu bar is dropped rather than hidden.
  Menu.setApplicationMenu(null)

  registerAppProtocol()
  applyContentSecurityPolicy()

  const appContext = createAppContext({
    userDataDir: app.getPath("userData"),
    documentsDir: app.getPath("documents"),
  })
  context = appContext

  const updater = createUpdater({ autoCheck: () => appContext.config.autoCheckUpdates })
  updater.start()

  // Decide the theme before any window exists: this is also what makes the
  // renderer's prefers-color-scheme report the user's choice.
  applyNativeTheme(appContext.config.theme)

  registerIpcHandlers(appContext, updater, {
    onThemeChanged: (theme) => {
      applyNativeTheme(theme)
      for (const win of BrowserWindow.getAllWindows()) paintWindow(win, theme)
    },
  })
  registerLbookProtocol(appContext)

  // The OS switched light/dark while we are following it.
  nativeTheme.on("updated", () => {
    if (appContext.config.theme !== "system") return
    for (const win of BrowserWindow.getAllWindows()) paintWindow(win, "system")
  })

  await createWindow()

  // Index whatever is in the library folder, without holding up the window.
  void appContext.library
    .scan()
    .then((result) => {
      const changed = result.added + result.updated + result.removed
      if (changed > 0) {
        console.log(
          `[main] library scan: +${result.added} ~${result.updated} -${result.removed}`,
        )
      }
      for (const skipped of result.skipped) {
        console.warn(`[main] skipped ${skipped.file}: ${skipped.reason}`)
      }
    })
    .catch((error: unknown) => {
      console.error("[main] library scan failed:", error)
    })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  void context?.dispose()
  context = null
})
