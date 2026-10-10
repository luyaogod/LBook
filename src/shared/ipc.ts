import type {
  BookToc,
  OcrBlock,
  OcrPage,
  OcrPageBrief,
  PdfDocument,
  PdfDocumentDetail,
  ReadingProgress,
  User,
} from "./types"
import type { TranslateResult, TranslateSettingsView } from "./translate"

/**
 * The IPC contract shared by main, preload and renderer.
 *
 * This module must stay free of `electron` imports and of side effects so it can
 * be imported from unit tests running under plain Node.
 */

export const IPC = {
  hello: "app:hello",

  libraryList: "library:list",
  libraryGet: "library:get",
  libraryScan: "library:scan",
  libraryImport: "library:import",
  libraryCreateFromFiles: "library:createFromFiles",
  libraryDelete: "library:delete",

  bookListPages: "book:listPages",
  bookGetPage: "book:getPage",
  bookReadPdfRange: "book:readPdfRange",
  bookUpdateBlock: "book:updateBlock",
  bookSave: "book:save",
  bookReplaceOcr: "book:replaceOcr",
  bookReplaceCover: "book:replaceCover",
  bookGetToc: "book:getToc",
  bookReplaceToc: "book:replaceToc",
  bookClearToc: "book:clearToc",

  userGetCurrent: "user:getCurrent",
  progressGet: "progress:get",
  progressSave: "progress:save",

  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsChooseLibraryDir: "settings:chooseLibraryDir",
  settingsRevealLibraryDir: "settings:revealLibraryDir",

  translateText: "translate:text",
  translateSpeak: "translate:speak",

  // The window controls are drawn by the app (see AppHeader), so they need a way
  // back into the main process that owns the window.
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",

  dialogPickFiles: "dialog:pickFiles",

  updatesGetState: "updates:getState",
  updatesCheck: "updates:check",
  updatesInstall: "updates:install",
} as const

export const UPDATE_STATUS_EVENT = "updates:status"
/** Main -> renderer: the window was maximized or restored. */
export const WINDOW_MAXIMIZED_EVENT = "window:maximized"

/** Mirrors the main-process updater state; kept here so both sides agree. */
export type UpdateStatus =
  | { state: "unsupported" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }

export type FileKind = "pdf" | "json" | "cover" | "lbook"

export interface TranslationSettingsPatch {
  provider?: string
  sourceLang?: string
  targetLang?: string
  /**
   * providerId -> fieldKey -> value.
   *
   * `""` means "leave the stored value alone" (an untouched password box posts an
   * empty string); `null` clears it.
   */
  values?: Record<string, Record<string, string | null>>
}

/**
 * Reading font size, in px.
 *
 * Lives here rather than in `main/config` because three places need the same
 * numbers: main clamps what it writes, the settings slider uses the bounds, and
 * the reset button needs the default. The value ends up in CSS as
 * `--reading-font-size` (see `.markdown-body` in index.css).
 */
export const READING_FONT_SIZE = { min: 12, max: 24, default: 14 } as const

export interface Settings {
  libraryDir: string
  /** False when libraryDir came from the default rather than the config file. */
  libraryDirIsDefault: boolean
  theme: "system" | "light" | "dark"
  autoCheckUpdates: boolean
  /** Size of the text in the reading panel; see `READING_FONT_SIZE`. */
  readingFontSize: number
  version: string
  translate: TranslateSettingsView
}

/**
 * A partial update: an absent field means "leave it alone".
 *
 * One named type rather than the same inline shape written out three times — in
 * the channel map, on the preload surface and in the main-process handler —
 * where adding a field used to mean three edits and two chances to forget one.
 */
export interface SettingsPatch {
  theme?: Settings["theme"]
  autoCheckUpdates?: boolean
  readingFontSize?: number
  translate?: TranslationSettingsPatch
}

export interface ScanResult {
  added: number
  updated: number
  removed: number
  skipped: Array<{ file: string; reason: string }>
}

/** Maps every channel to its request and response payload types. */
export interface IpcMap {
  [IPC.hello]: { req: void; res: string }

  [IPC.libraryList]: { req: void; res: PdfDocument[] }
  [IPC.libraryGet]: { req: { pdfId: number }; res: PdfDocumentDetail | null }
  [IPC.libraryScan]: { req: void; res: ScanResult }
  [IPC.libraryImport]: { req: { filePath: string }; res: PdfDocument }
  [IPC.libraryCreateFromFiles]: {
    req: {
      pdfPath: string
      ocrPath: string
      coverPath: string | null
      /** Optional toc.json to embed in the new package. */
      tocPath: string | null
      title?: string
    }
    res: PdfDocument
  }
  [IPC.libraryDelete]: { req: { pdfId: number; deleteFile: boolean }; res: void }

  [IPC.bookListPages]: { req: { pdfId: number }; res: OcrPageBrief[] }
  [IPC.bookGetPage]: { req: { pdfId: number; pageNum: number }; res: OcrPage | null }
  [IPC.bookReadPdfRange]: { req: { pdfId: number; begin: number; end: number }; res: Uint8Array }
  [IPC.bookUpdateBlock]: { req: { blockId: number; blockContent: string }; res: OcrBlock }
  [IPC.bookSave]: { req: { pdfId: number }; res: PdfDocument }
  [IPC.bookReplaceOcr]: { req: { pdfId: number; ocrPath: string }; res: PdfDocument }
  [IPC.bookReplaceCover]: { req: { pdfId: number; coverPath: string }; res: PdfDocument }
  [IPC.bookGetToc]: { req: { pdfId: number }; res: BookToc | null }
  [IPC.bookReplaceToc]: { req: { pdfId: number; tocPath: string }; res: BookToc }
  [IPC.bookClearToc]: { req: { pdfId: number }; res: void }

  [IPC.userGetCurrent]: { req: void; res: User }
  [IPC.progressGet]: { req: { pdfId: number }; res: ReadingProgress | null }
  [IPC.progressSave]: { req: { pdfId: number; lastPageNum: number }; res: ReadingProgress }

  [IPC.settingsGet]: { req: void; res: Settings }
  [IPC.settingsSet]: {
    req: SettingsPatch
    res: Settings
  }
  [IPC.settingsChooseLibraryDir]: { req: void; res: Settings | null }
  [IPC.settingsRevealLibraryDir]: { req: void; res: void }

  /** Translates one selection. `source` may be "auto"; `target` defaults to config. */
  [IPC.translateText]: {
    req: { text: string; source?: string; target?: string }
    res: TranslateResult
  }

  /** Reads text aloud. Needs a provider that implements speech. */
  [IPC.translateSpeak]: {
    req: { text: string; language: string }
    res: { audio: Uint8Array; mime: string }
  }

  [IPC.windowMinimize]: { req: void; res: void }
  [IPC.windowToggleMaximize]: { req: void; res: void }
  [IPC.windowClose]: { req: void; res: void }

  [IPC.dialogPickFiles]: { req: { kind: FileKind }; res: string[] }
  [IPC.updatesGetState]: { req: void; res: UpdateStatus }
  [IPC.updatesCheck]: { req: void; res: UpdateStatus }
  [IPC.updatesInstall]: { req: void; res: void }
}

export type Req<C extends keyof IpcMap> = IpcMap[C]["req"]
export type Res<C extends keyof IpcMap> = IpcMap[C]["res"]

/** PDF renderer bookkeeping: the PDF entry's exact byte length. */
export interface BookFileInfo {
  pdfSize: number
}

/**
 * The narrow surface exposed to the renderer on `window.api`.
 *
 * Deliberately named and closed — never a generic `invoke(channel, payload)`,
 * which would hand the renderer the whole main process.
 */
export interface LbookApi {
  hello(): Promise<string>
  library: {
    list(): Promise<PdfDocument[]>
    get(pdfId: number): Promise<PdfDocumentDetail | null>
    scan(): Promise<ScanResult>
    import(filePath: string): Promise<PdfDocument>
    createFromFiles(input: {
      pdfPath: string
      ocrPath: string
      coverPath: string | null
      tocPath: string | null
      title?: string
    }): Promise<PdfDocument>
    remove(pdfId: number, deleteFile: boolean): Promise<void>
  }
  book: {
    listPages(pdfId: number): Promise<OcrPageBrief[]>
    getPage(pdfId: number, pageNum: number): Promise<OcrPage | null>
    readPdfRange(pdfId: number, begin: number, end: number): Promise<Uint8Array>
    updateBlock(blockId: number, blockContent: string): Promise<OcrBlock>
    save(pdfId: number): Promise<PdfDocument>
    replaceOcr(pdfId: number, ocrPath: string): Promise<PdfDocument>
    replaceCover(pdfId: number, coverPath: string): Promise<PdfDocument>
    /** The book's table of contents, or null when it has none. */
    getToc(pdfId: number): Promise<BookToc | null>
    /** Writes the chosen toc.json into the package, replacing any existing one. */
    replaceToc(pdfId: number, tocPath: string): Promise<BookToc>
    /** Drops the table of contents entry from the package. */
    clearToc(pdfId: number): Promise<void>
  }
  user: {
    current(): Promise<User>
  }
  progress: {
    get(pdfId: number): Promise<ReadingProgress | null>
    save(pdfId: number, lastPageNum: number): Promise<ReadingProgress>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
    chooseLibraryDir(): Promise<Settings | null>
    revealLibraryDir(): Promise<void>
  }
  translate: {
    /** Translates a highlighted selection; vendors are configured in settings. */
    text(input: { text: string; source?: string; target?: string }): Promise<TranslateResult>
    /** Reads text aloud (MP3 bytes) through the active vendor. */
    speak(input: { text: string; language: string }): Promise<{ audio: Uint8Array; mime: string }>
  }
  /** The window controls the app draws itself, instead of Windows' own. */
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    /** Fires with the new maximized state, so the icon can flip. */
    onMaximizeChanged(callback: (maximized: boolean) => void): () => void
  }
  dialog: {
    pickFiles(kind: FileKind): Promise<string[]>
  }
  updates: {
    getState(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
  }
  events: {
    /** Fires when packages are added, imported, removed or the library moves. */
    onLibraryChanged(callback: () => void): () => void
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  }
  /**
   * Probed at preload time. When false the renderer must obtain file paths via
   * the open dialog instead of drag-and-drop.
   */
  capabilities: { filePaths: boolean }
  files: {
    /** Absolute path of a dropped/selected File, or null when unavailable. */
    getPath(file: File): string | null
  }
}
