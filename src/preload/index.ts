import { contextBridge, ipcRenderer } from "electron"
import { IPC, UPDATE_STATUS_EVENT, WINDOW_MAXIMIZED_EVENT, BOOK_CHANGED_EVENT, type BookChangePayload, type LbookApi, type UpdateStatus } from "../shared/ipc"

/**
 * The bridge the renderer sees as `window.api`.
 *
 * Every method is a named channel with a typed payload — never a generic
 * `invoke(channel, payload)`, which would hand the renderer the whole main
 * process. Books are named by `uid` (their `meta.json` identity), so nothing here
 * deals in row ids or paths the renderer did not receive from a dialog.
 */
const api: LbookApi = {
  hello: () => ipcRenderer.invoke(IPC.hello),

  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    get: (uid) => ipcRenderer.invoke(IPC.libraryGet, { uid }),
    open: (dir) => ipcRenderer.invoke(IPC.libraryOpen, { dir }),
    remove: (uid) => ipcRenderer.invoke(IPC.libraryRemove, { uid }),
    openPath: (uid, kind) => ipcRenderer.invoke(IPC.libraryOpenPath, { uid, kind }),
    showInFolder: (uid, kind) => ipcRenderer.invoke(IPC.libraryShowInFolder, { uid, kind }),
    inspect: (uid, deep) => ipcRenderer.invoke(IPC.libraryInspect, { uid, deep }),
    leftovers: () => ipcRenderer.invoke(IPC.libraryLeftovers),
    openLibraryDir: () => ipcRenderer.invoke(IPC.libraryOpenLibraryDir),
    refresh: () => ipcRenderer.invoke(IPC.libraryRefresh),
  },

  book: {
    getPage: (uid, pageNum) => ipcRenderer.invoke(IPC.bookGetPage, { uid, pageNum }),
    readPdfRange: (uid, begin, end) => ipcRenderer.invoke(IPC.bookReadPdfRange, { uid, begin, end }),
    getToc: (uid) => ipcRenderer.invoke(IPC.bookGetToc, { uid }),
  },

  progress: {
    get: (uid) => ipcRenderer.invoke(IPC.progressGet, { uid }),
    save: (uid, lastPageNum) => ipcRenderer.invoke(IPC.progressSave, { uid, lastPageNum }),
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },

  translate: {
    text: (input) => ipcRenderer.invoke(IPC.translateText, input),
    speak: (input) => ipcRenderer.invoke(IPC.translateSpeak, input),
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    onMaximizeChanged: (callback) => {
      const listener = (_event: unknown, maximized: boolean) => callback(maximized)
      ipcRenderer.on(WINDOW_MAXIMIZED_EVENT, listener)
      return () => ipcRenderer.removeListener(WINDOW_MAXIMIZED_EVENT, listener)
    },
  },

  updates: {
    getState: () => ipcRenderer.invoke(IPC.updatesGetState),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
  },

  events: {
    onLibraryChanged: (callback) => {
      const listener = () => callback()
      ipcRenderer.on("library:changed", listener)
      return () => ipcRenderer.removeListener("library:changed", listener)
    },
    onBookChanged: (callback) => {
      const listener = (_event: unknown, change: BookChangePayload) => callback(change)
      ipcRenderer.on(BOOK_CHANGED_EVENT, listener)
      return () => ipcRenderer.removeListener(BOOK_CHANGED_EVENT, listener)
    },
    onUpdateStatus: (callback) => {
      const listener = (_event: unknown, status: UpdateStatus) => callback(status)
      ipcRenderer.on(UPDATE_STATUS_EVENT, listener)
      return () => ipcRenderer.removeListener(UPDATE_STATUS_EVENT, listener)
    },
  },
}

contextBridge.exposeInMainWorld("api", api)
