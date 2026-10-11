import { app, BrowserWindow, Menu, nativeTheme } from "electron"
import path from "node:path"
import { BOOK_CHANGED_EVENT, WINDOW_MAXIMIZED_EVENT } from "../shared/ipc"
import { createAppContext, type AppContext } from "./context"
import { registerIpcHandlers } from "./ipc/register"
import { applyContentSecurityPolicy, registerBundleProtocol, registerShellSchemes } from "./bundleHost"
import { registerLbookProtocol } from "./protocol/lbookProtocol"
import { applyNativeTheme, paintWindow, windowColors } from "./theme"
import { createUpdater } from "./updater"


// LBOOK_USE_BUNDLE=1 exercises the production app:// path without packaging.
const isDev = !app.isPackaged && process.env.LBOOK_USE_BUNDLE !== "1"
const DEV_SERVER_URL = process.env.LBOOK_DEV_SERVER_URL ?? "http://localhost:5173"

// out/main/index.cjs -> out/renderer
const RENDERER_DIR = path.join(__dirname, "..", "renderer")

let context: AppContext | null = null

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
  // here or duplicate shortcuts the renderer already owns, so the whole menu bar
  // is dropped rather than hidden.
  Menu.setApplicationMenu(null)

  registerBundleProtocol(RENDERER_DIR)
  if (!isDev) applyContentSecurityPolicy()

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
  registerShellSchemes()
  registerLbookProtocol(appContext)


  // The OS switched light/dark while we are following it.
  nativeTheme.on("updated", () => {
    if (appContext.config.theme !== "system") return
    for (const win of BrowserWindow.getAllWindows()) paintWindow(win, "system")
  })

  await createWindow()

  // An edit made in the reader's own editor reaches the interface through here.
  // The watch is per book folder and the payload carries the uid, so the open book
  // re-reads its page without the library list moving.
  appContext.library.onBookChanged((change) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(BOOK_CHANGED_EVENT, change)
    }
  })

  // Coming back to the window is the second layer of the reactivity story: a watch can
  // fail to attach (a network share) or silently stop, while focus always happens.
  app.on("browser-window-focus", () => {
    const appContext = context
    if (!appContext) return
    appContext.library.refresh()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("library:changed")
      window.webContents.send(BOOK_CHANGED_EVENT, { uid: "", dir: "", changed: ["other"] })
    }
  })

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  context?.dispose()
  context = null
})
