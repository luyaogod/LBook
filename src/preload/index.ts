import { contextBridge, ipcRenderer, webUtils } from "electron"
import { IPC, UPDATE_STATUS_EVENT, WINDOW_MAXIMIZED_EVENT, type LbookApi, type UpdateStatus } from "../shared/ipc"

// webUtils is only present in recent Electron builds; probe once so the renderer
// can fall back to the open dialog for drag-and-drop.
const canResolveFilePaths = typeof webUtils?.getPathForFile === "function"

const api: LbookApi = {
  hello: () => ipcRenderer.invoke(IPC.hello),

  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    get: (pdfId) => ipcRenderer.invoke(IPC.libraryGet, { pdfId }),
    scan: () => ipcRenderer.invoke(IPC.libraryScan),
    import: (filePath) => ipcRenderer.invoke(IPC.libraryImport, { filePath }),
    createFromFiles: (input) => ipcRenderer.invoke(IPC.libraryCreateFromFiles, input),
    remove: (pdfId, deleteFile) => ipcRenderer.invoke(IPC.libraryDelete, { pdfId, deleteFile }),
  },

  book: {
    listPages: (pdfId) => ipcRenderer.invoke(IPC.bookListPages, { pdfId }),
    getPage: (pdfId, pageNum) => ipcRenderer.invoke(IPC.bookGetPage, { pdfId, pageNum }),
    readPdfRange: (pdfId, begin, end) =>
      ipcRenderer.invoke(IPC.bookReadPdfRange, { pdfId, begin, end }),
    updateBlock: (blockId, blockContent) =>
      ipcRenderer.invoke(IPC.bookUpdateBlock, { blockId, blockContent }),
    save: (pdfId) => ipcRenderer.invoke(IPC.bookSave, { pdfId }),
    replaceOcr: (pdfId, ocrPath) => ipcRenderer.invoke(IPC.bookReplaceOcr, { pdfId, ocrPath }),
    replaceCover: (pdfId, coverPath) => ipcRenderer.invoke(IPC.bookReplaceCover, { pdfId, coverPath }),
    getToc: (pdfId) => ipcRenderer.invoke(IPC.bookGetToc, { pdfId }),
    replaceToc: (pdfId, tocPath) => ipcRenderer.invoke(IPC.bookReplaceToc, { pdfId, tocPath }),
    clearToc: (pdfId) => ipcRenderer.invoke(IPC.bookClearToc, { pdfId }),
  },

  user: {
    current: () => ipcRenderer.invoke(IPC.userGetCurrent),
  },

  progress: {
    get: (pdfId) => ipcRenderer.invoke(IPC.progressGet, { pdfId }),
    save: (pdfId, lastPageNum) => ipcRenderer.invoke(IPC.progressSave, { pdfId, lastPageNum }),
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    chooseLibraryDir: () => ipcRenderer.invoke(IPC.settingsChooseLibraryDir),
    revealLibraryDir: () => ipcRenderer.invoke(IPC.settingsRevealLibraryDir),
  },

  dialog: {
    pickFiles: (kind) => ipcRenderer.invoke(IPC.dialogPickFiles, { kind }),
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
    onUpdateStatus: (callback) => {
      const listener = (_event: unknown, status: UpdateStatus) => callback(status)
      ipcRenderer.on(UPDATE_STATUS_EVENT, listener)
      return () => ipcRenderer.removeListener(UPDATE_STATUS_EVENT, listener)
    },
  },

  capabilities: { filePaths: canResolveFilePaths },

  files: {
    getPath: (file) => (canResolveFilePaths ? webUtils.getPathForFile(file) : null),
  },
}

contextBridge.exposeInMainWorld("api", api)
