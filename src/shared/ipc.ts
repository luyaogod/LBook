import type {
  BookToc,
  OcrPage,
  PdfDocument,
  ReadingProgress,
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
  /** Adds a folder the user picked to the library (the only way a book arrives). */
  libraryOpen: "library:open",
  /** Forgets an entry. Never touches the disk (A11). */
  libraryRemove: "library:remove",
  libraryReveal: "library:reveal",

  bookGetPage: "book:getPage",
  bookReadPdfRange: "book:readPdfRange",
  bookGetToc: "book:getToc",

  progressGet: "progress:get",
  progressSave: "progress:save",

  settingsGet: "settings:get",
  settingsSet: "settings:set",

  translateText: "translate:text",
  translateSpeak: "translate:speak",

  // The window controls are drawn by the app (see AppHeader), so they need a way
  // back into the main process that owns the window.
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",

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

/**
 * Which language the interface is drawn in.
 *
 * Here rather than in the renderer because both ends need the list: main
 * validates what it stores in `config.json`, the settings page draws the cards.
 * English is the source of truth and the fallback. "system" follows the OS.
 */
export type LocaleChoice = "system" | "en" | "zh-CN"
export const LOCALE_CHOICES: readonly LocaleChoice[] = ["en", "zh-CN", "system"]

export interface Settings {
  /**
   * Where a new book folder is created by default, and where the folder picker
   * starts. Books already in the library may live anywhere (A11); this is only a
   * convenience, so the app never takes ownership of the location.
   */
  libraryDir: string
  /** False when libraryDir came from the default rather than the config file. */
  libraryDirIsDefault: boolean
  theme: "system" | "light" | "dark"
  autoCheckUpdates: boolean
  /** Size of the text in the reading panel; see `READING_FONT_SIZE`. */
  readingFontSize: number
  /** Interface language; see `LocaleChoice`. */
  locale: LocaleChoice
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
  locale?: LocaleChoice
  translate?: TranslationSettingsPatch
}

/**
 * What happened when the user picked a folder to add as a book.
 *
 * "Not a book" is a normal answer here, not an error to log: the user may have
 * picked the wrong folder, and the reply says exactly what a book folder needs to
 * contain. `adopted` is true when a `meta.json` had to be written (a folder of
 * PaddleOCR output that was never a package).
 */
export type OpenBookOutcome =
  | { ok: true; doc: PdfDocument; alreadyKnown: boolean; adopted: boolean }
  | { ok: false; error: string }

/** Maps every channel to its request and response payload types. */
export interface IpcMap {
  [IPC.hello]: { req: void; res: string }

  [IPC.libraryList]: { req: void; res: PdfDocument[] }
  [IPC.libraryGet]: { req: { uid: string }; res: PdfDocument | null }
  [IPC.libraryOpen]: { req: { dir?: string }; res: OpenBookOutcome | null }
  [IPC.libraryRemove]: { req: { uid: string }; res: boolean }
  [IPC.libraryReveal]: { req: { uid: string }; res: void }

  [IPC.bookGetPage]: { req: { uid: string; pageNum: number }; res: OcrPage | null }
  [IPC.bookReadPdfRange]: { req: { uid: string; begin: number; end: number }; res: Uint8Array }
  [IPC.bookGetToc]: { req: { uid: string }; res: BookToc | null }

  [IPC.progressGet]: { req: { uid: string }; res: ReadingProgress | null }
  [IPC.progressSave]: { req: { uid: string; lastPageNum: number }; res: ReadingProgress }

  [IPC.settingsGet]: { req: void; res: Settings }
  [IPC.settingsSet]: {
    req: SettingsPatch
    res: Settings
  }

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
    get(uid: string): Promise<PdfDocument | null>
    /**
     * Registers a folder as a book. With no argument the main process opens a
     * folder picker; null means the user cancelled it. The app never copies or
     * moves the user's files.
     */
    open(dir?: string): Promise<OpenBookOutcome | null>
    /** Forgets an entry; the folder on disk is left alone (A11). */
    remove(uid: string): Promise<boolean>
    /** Shows the book folder in the OS file manager. */
    reveal(uid: string): Promise<void>
  }
  book: {
    getPage(uid: string, pageNum: number): Promise<OcrPage | null>
    readPdfRange(uid: string, begin: number, end: number): Promise<Uint8Array>
    /** The book's table of contents, or null when it has none. */
    getToc(uid: string): Promise<BookToc | null>
  }
  progress: {
    get(uid: string): Promise<ReadingProgress | null>
    save(uid: string, lastPageNum: number): Promise<ReadingProgress>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: SettingsPatch): Promise<Settings>
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
  updates: {
    getState(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
  }
  events: {
    /** Fires when the library list changes (a book was added or dropped). */
    onLibraryChanged(callback: () => void): () => void
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  }
}
