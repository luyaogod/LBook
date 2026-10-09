import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import {
  IPC,
  UPDATE_STATUS_EVENT,
  type FileKind,
  type ScanResult,
  type Settings,
  type TranslationSettingsPatch,
} from "../../shared/ipc"
import type { AppContext } from "../context"
import type { Theme } from "../config/config"
import { ImportSkipped } from "../library/importer"
import type { Updater } from "../updater"

const FILE_FILTERS: Record<FileKind, Electron.FileFilter[]> = {
  pdf: [{ name: "PDF documents", extensions: ["pdf"] }],
  json: [{ name: "PaddleOCR output", extensions: ["json"] }],
  cover: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
  lbook: [{ name: "LBook packages", extensions: ["lbook"] }],
}

function settingsPayload(context: AppContext): Settings {
  return {
    libraryDir: context.libraryDir(),
    libraryDirIsDefault: context.isLibraryDirDefault(),
    theme: context.config.theme,
    autoCheckUpdates: context.config.autoCheckUpdates,
    version: app.getVersion(),
    translate: context.translate.settingsView(),
  }
}

/** Turns an unknown thrown value into a clean message for the renderer. */
function messageOf(error: unknown): string {
  if (error instanceof ImportSkipped) return error.reason
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

  ipcMain.handle(IPC.libraryGet, (_event, { pdfId }: { pdfId: number }) => library.get(pdfId))

  ipcMain.handle(IPC.libraryScan, async (): Promise<ScanResult> => {
    const result = await library.scan()
    broadcastLibraryChanged()
    return result
  })

  ipcMain.handle(IPC.libraryImport, async (_event, { filePath }: { filePath: string }) => {
    try {
      const doc = await library.importFile(filePath)
      broadcastLibraryChanged()
      return doc
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  ipcMain.handle(
    IPC.libraryCreateFromFiles,
    async (
      _event,
      input: {
        pdfPath: string
        ocrPath: string
        coverPath: string | null
        tocPath: string | null
        title?: string
      },
    ) => {
      try {
        const doc = await library.createFromFiles(input)
        broadcastLibraryChanged()
        return doc
      } catch (error) {
        throw new Error(messageOf(error))
      }
    },
  )

  ipcMain.handle(
    IPC.libraryDelete,
    (_event, { pdfId, deleteFile }: { pdfId: number; deleteFile: boolean }) => {
      library.remove(pdfId, deleteFile)
      broadcastLibraryChanged()
    },
  )

  // ---- book ----------------------------------------------------------------
  ipcMain.handle(IPC.bookListPages, (_event, { pdfId }: { pdfId: number }) =>
    library.listPages(pdfId),
  )

  ipcMain.handle(
    IPC.bookGetPage,
    (_event, { pdfId, pageNum }: { pdfId: number; pageNum: number }) =>
      library.getPage(pdfId, pageNum),
  )

  ipcMain.handle(
    IPC.bookReadPdfRange,
    async (_event, { pdfId, begin, end }: { pdfId: number; begin: number; end: number }) => {
      const buffer = await library.readPdfRange(pdfId, begin, end)
      // Structured clone turns this into a Uint8Array on the renderer side,
      // which is exactly what PDFDataRangeTransport.onDataRange wants.
      return buffer
    },
  )

  ipcMain.handle(
    IPC.bookUpdateBlock,
    (_event, { blockId, blockContent }: { blockId: number; blockContent: string }) =>
      library.updateBlock(blockId, blockContent),
  )

  ipcMain.handle(IPC.bookSave, async (_event, { pdfId }: { pdfId: number }) => {
    try {
      const doc = await library.save(pdfId)
      broadcastLibraryChanged()
      return doc
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  ipcMain.handle(
    IPC.bookReplaceOcr,
    async (_event, { pdfId, ocrPath }: { pdfId: number; ocrPath: string }) => {
      try {
        const doc = await library.replaceOcr(pdfId, ocrPath)
        broadcastLibraryChanged()
        return doc
      } catch (error) {
        throw new Error(messageOf(error))
      }
    },
  )

  ipcMain.handle(
    IPC.bookReplaceCover,
    async (_event, { pdfId, coverPath }: { pdfId: number; coverPath: string }) => {
      try {
        const doc = await library.replaceCover(pdfId, coverPath)
        broadcastLibraryChanged()
        return doc
      } catch (error) {
        throw new Error(messageOf(error))
      }
    },
  )

  // ---- table of contents ---------------------------------------------------
  ipcMain.handle(IPC.bookGetToc, async (_event, { pdfId }: { pdfId: number }) => {
    try {
      return await library.getToc(pdfId)
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  ipcMain.handle(IPC.bookReplaceToc, async (_event, { pdfId, tocPath }: { pdfId: number; tocPath: string }) => {
    try {
      const toc = await library.replaceToc(pdfId, tocPath)
      broadcastLibraryChanged()
      return toc
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  ipcMain.handle(IPC.bookClearToc, async (_event, { pdfId }: { pdfId: number }) => {
    try {
      await library.clearToc(pdfId)
      broadcastLibraryChanged()
    } catch (error) {
      throw new Error(messageOf(error))
    }
  })

  // ---- user and progress ---------------------------------------------------
  ipcMain.handle(IPC.userGetCurrent, () => library.currentUser())

  ipcMain.handle(IPC.progressGet, (_event, { pdfId }: { pdfId: number }) =>
    library.getProgress(pdfId),
  )

  ipcMain.handle(
    IPC.progressSave,
    (_event, { pdfId, lastPageNum }: { pdfId: number; lastPageNum: number }) =>
      library.saveProgress(pdfId, lastPageNum),
  )

  // ---- settings ------------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, () => settingsPayload(context))

  ipcMain.handle(
    IPC.settingsSet,
    (
      _event,
      patch: {
        theme?: Settings["theme"]
        autoCheckUpdates?: boolean
        translate?: TranslationSettingsPatch
      },
    ) => {
      if (patch.theme !== undefined || patch.autoCheckUpdates !== undefined) {
        context.updateSettings({ theme: patch.theme, autoCheckUpdates: patch.autoCheckUpdates })
        if (patch.theme !== undefined) hooks.onThemeChanged?.(patch.theme)
      }
      if (patch.translate) context.translate.updateSettings(patch.translate)
      return settingsPayload(context)
    },
  )

  ipcMain.handle(IPC.settingsChooseLibraryDir, async (): Promise<Settings | null> => {
    const result = await dialog.showOpenDialog({
      title: "Choose a library folder",
      defaultPath: context.libraryDir(),
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return null

    await context.changeLibraryDir(result.filePaths[0])
    broadcastLibraryChanged()
    return settingsPayload(context)
  })

  ipcMain.handle(IPC.settingsRevealLibraryDir, async () => {
    const error = await shell.openPath(context.libraryDir())
    if (error) throw new Error(error)
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

  // ---- dialogs -------------------------------------------------------------
  ipcMain.handle(IPC.dialogPickFiles, async (_event, { kind }: { kind: FileKind }) => {
    const result = await dialog.showOpenDialog({
      title: "Select a file",
      properties: ["openFile"],
      filters: FILE_FILTERS[kind],
    })
    return result.canceled ? [] : result.filePaths
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
