import fs from "node:fs"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import {
  BOOK_CHANGED_EVENT,
  IPC,
  UPDATE_STATUS_EVENT,
  type BookChangePayload,
  type BookFileKind,
  type Settings,
  type SettingsPatch,
} from "../../shared/ipc"
import { inspectBook } from "../library/inspect"

/**
 * The extension of the old package format.
 *
 * A literal rather than an import from `src/main/migrate/`: the running app knows
 * nothing about `.lbook` (A12), and the only reason this name appears at all is to
 * notice old files sitting in the default location and point at the one-time script.
 */
const LEFTOVER_EXTENSION = ".lbook"
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

/**
 * Tells every window that a book's files changed.
 *
 * An empty uid means "any open book": used by the focus rescan, where the point is
 * that the renderer cannot know what changed while it was in the background.
 */
function broadcastBookChanged(change: BookChangePayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(BOOK_CHANGED_EVENT, change)
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

  /**
   * Opens a book's folder, or one of its files, in whatever the OS uses for it.
   *
   * The renderer names a *role* and the library resolves the path: the OCR file is
   * not always called `ocr.json`, and a path that came from a dialog is the
   * renderer's only business with paths at all.
   */
  ipcMain.handle(IPC.libraryOpenPath, async (_event, { uid, kind }: { uid: string; kind: BookFileKind }) => {
    const file = await library.resolveFile(uid, kind)
    if (!file) throw new Error(`this book has no ${kind} file`)
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.libraryShowInFolder, async (_event, { uid, kind }: { uid: string; kind: BookFileKind }) => {
    const file = await library.resolveFile(uid, kind)
    if (!file) throw new Error(`this book has no ${kind} file`)
    shell.showItemInFolder(file)
  })

  /**
   * The validation rules, run over one book.
   *
   * Deep by default: it parses every page of the OCR file, which is what finds a page
   * that was edited into a broken state. That takes about 300ms on the largest book
   * here, so it is always a button the reader pressed rather than something the
   * library listing does.
   */
  ipcMain.handle(IPC.libraryInspect, async (_event, { uid, deep }: { uid: string; deep?: boolean }) => {
    const doc = await library.get(uid)
    if (!doc) throw new Error("this book is no longer in the library")
    return inspectBook(doc.dir, { deep: deep !== false })
  })

  /**
   * Old packages sitting in the default location.
   *
   * The migration itself is a one-time script, not an app feature (A12): the app has
   * no zip reader and no SQLite any more. So what the interface can honestly offer is
   * the list, the folder, and the command.
   */
  ipcMain.handle(IPC.libraryLeftovers, async () => {
    const dir = context.libraryDir()
    try {
      return {
        dir,
        files: fs
          .readdirSync(dir)
          .filter((name) => name.toLowerCase().endsWith(LEFTOVER_EXTENSION))
          .sort(),
      }
    } catch {
      return { dir, files: [] }
    }
  })

  /**
   * "Look at the folders again".
   *
   * The window sends this when it regains focus: a watch is the accelerator, not the
   * mechanism (see `library/watch.ts`), and on a network share or a removable drive
   * it may never fire. Broadcasting afterwards is what makes every open view re-read.
   */
  ipcMain.handle(IPC.libraryRefresh, () => {
    library.refresh()
    broadcastLibraryChanged()
    broadcastBookChanged({ uid: "", dir: "", changed: ["other"] })
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
