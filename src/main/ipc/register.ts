import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { IPC, UPDATE_STATUS_EVENT, type Settings, type SettingsPatch } from "../../shared/ipc"
import type { AppContext } from "../context"
import type { Theme } from "../config/config"
import type { Updater } from "../updater"

function settingsPayload(context: AppContext): Settings {
  return {
    libraryDir: context.libraryDir(),
    libraryDirIsDefault: context.isLibraryDirDefault(),
    theme: context.config.theme,
    autoCheckUpdates: context.config.autoCheckUpdates,
    readingFontSize: context.config.readingFontSize,
    locale: context.config.locale,
    version: app.getVersion(),
    translate: context.translate.settingsView(),
  }
}

/** Turns an unknown thrown value into a clean message for the renderer. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function broadcastLibraryChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("library:changed")
  }
}

export interface IpcHandlerHooks {
  /** Called after the theme setting changes, so the window can be repainted. */
  onThemeChanged?: (theme: Theme) => void
}

export function registerIpcHandlers(
  context: AppContext,
  updater: Updater,
  hooks: IpcHandlerHooks = {},
): void {
  const { library } = context

  ipcMain.handle(IPC.hello, () => "Hello World")

  // ---- updates -------------------------------------------------------------
  ipcMain.handle(IPC.updatesGetState, () => updater.getState())
  ipcMain.handle(IPC.updatesCheck, () => updater.check())
  ipcMain.handle(IPC.updatesInstall, () => updater.install())

  updater.onChange((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(UPDATE_STATUS_EVENT, status)
    }
  })

  // ---- library -------------------------------------------------------------
  ipcMain.handle(IPC.libraryList, () => library.list())

  ipcMain.handle(IPC.libraryGet, (_event, { uid }: { uid: string }) => library.get(uid))

  /**
   * Adds a book folder.
   *
   * With no `dir` the main process asks for one — the picker has to run here, and
   * keeping it in this handler means the renderer never handles a path it did not
   * get from a dialog. A cancelled dialog is `null`, which is not a failure.
   */
  ipcMain.handle(IPC.libraryOpen, async (_event, { dir }: { dir?: string }) => {
    let target = dir
    if (!target) {
      const result = await dialog.showOpenDialog({
        title: "Open a book folder",
        defaultPath: context.libraryDir(),
        properties: ["openDirectory"],
        buttonLabel: "Add book",
      })
      if (result.canceled || result.filePaths.length === 0) return null
      target = result.filePaths[0]
    }

    const outcome = await library.open(target)
    if (outcome.ok) broadcastLibraryChanged()
    return outcome
  })

  ipcMain.handle(IPC.libraryRemove, (_event, { uid }: { uid: string }) => {
    const removed = library.remove(uid)
    if (removed) broadcastLibraryChanged()
    return removed
  })

  ipcMain.handle(IPC.libraryReveal, async (_event, { uid }: { uid: string }) => {
    const doc = await library.get(uid)
    if (!doc) throw new Error("this book is no longer in the library")
    const error = await shell.openPath(doc.dir)
    if (error) throw new Error(error)
  })

  // ---- book ----------------------------------------------------------------
  ipcMain.handle(
    IPC.bookGetPage,
    (_event, { uid, pageNum }: { uid: string; pageNum: number }) =>
      library.getPage(uid, pageNum),
  )

  ipcMain.handle(
    IPC.bookReadPdfRange,
    async (_event, { uid, begin, end }: { uid: string; begin: number; end: number }) => {
      const buffer = await library.readPdfRange(uid, begin, end)
      // Structured clone turns this into a Uint8Array on the renderer side,
      // which is exactly what PDFDataRangeTransport.onDataRange wants.
      return buffer
    },
  )

  ipcMain.handle(IPC.bookGetToc, async (_event, { uid }: { uid: string }) => {
    try {
      return await library.getToc(uid)
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  // ---- progress ------------------------------------------------------------
  ipcMain.handle(IPC.progressGet, (_event, { uid }: { uid: string }) => library.progress.get(uid))

  ipcMain.handle(
    IPC.progressSave,
    async (_event, { uid, lastPageNum }: { uid: string; lastPageNum: number }) => {
      try {
        return await library.progress.save(uid, lastPageNum)
      } catch (error) {
        throw new Error(messageOf(error))
      }
    },
  )

  // ---- settings ------------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, () => settingsPayload(context))

  ipcMain.handle(IPC.settingsSet, (_event, patch: SettingsPatch) => {
    if (
      patch.theme !== undefined ||
      patch.autoCheckUpdates !== undefined ||
      patch.readingFontSize !== undefined ||
      patch.locale !== undefined
    ) {
      context.updateSettings({
        theme: patch.theme,
        autoCheckUpdates: patch.autoCheckUpdates,
        readingFontSize: patch.readingFontSize,
        locale: patch.locale,
      })
      if (patch.theme !== undefined) hooks.onThemeChanged?.(patch.theme)
    }
    if (patch.translate) context.translate.updateSettings(patch.translate)
    return settingsPayload(context)
  })

  // ---- window controls -----------------------------------------------------
  // The app draws its own minimize/maximize/close (see AppHeader). Doing it here
  // rather than through `titleBarOverlay` is what lets all three share one colour
  // and one hover: Windows paints its overlay strip in its own colour and hovers
  // the close button in the system red.
  const senderWindow = (event: { sender: Electron.WebContents }) =>
    BrowserWindow.fromWebContents(event.sender)

  ipcMain.handle(IPC.windowMinimize, (event) => {
    senderWindow(event)?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(IPC.windowClose, (event) => {
    senderWindow(event)?.close()
  })

  // ---- translation ---------------------------------------------------------
  ipcMain.handle(
    IPC.translateText,
    async (_event, input: { text: string; source?: string; target?: string }) => {
      try {
        return await context.translate.translate(input)
      } catch (error) {
        // A vendor error carries a code and a RequestId worth showing verbatim.
        throw new Error(messageOf(error))
      }
    },
  )

  ipcMain.handle(IPC.translateSpeak, async (_event, input: { text: string; language: string }) => {
    try {
      return await context.translate.speak(input)
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })
}
