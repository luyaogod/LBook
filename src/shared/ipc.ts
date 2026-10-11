import type {
  BookToc,
  OcrPage,
  PdfDocument,
  ReadingProgress,
} from "./types"
import type { TranslateResult, TranslateSettingsView } from "./translate"
import type { BookIssue } from "./validateBook"

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
  /** Opens a book's folder — or one of its files — in the OS's own program. */
  libraryOpenPath: "library:openPath",
  /** Shows one of them in the file manager, selected. */
  libraryShowInFolder: "library:showInFolder",
  /** Runs the validation rules over one book and returns what is wrong with it. */
  libraryInspect: "library:inspect",
  /** Old `.lbook` packages still sitting in the default location. */
  libraryLocate: "library:locate",
  libraryLeftovers: "library:leftovers",
  /** Opens the default new-book location itself, for the migration hint. */
  libraryOpenLibraryDir: "library:openLibraryDir",
  /** Validates chosen files and reports what a new book would be. Writes nothing. */
  libraryPreviewBook: "library:previewBook",
  /** Creates a book folder from files the reader picked. */
  libraryCreateBook: "library:createBook",
  /**
   * Asks main to forget what it has cached and tell everyone the library changed.
   *
   * Sent when the window regains focus (a network share or a removable drive may
   * never fire a watch) and by the Refresh button.
   */
  libraryRefresh: "library:refresh",

  bookGetPage: "book:getPage",
  bookReadPdfRange: "book:readPdfRange",
  bookGetToc: "book:getToc",
  /** Replaces one of a book's files (ocr, cover, toc, pdf) or its title. */
  bookReplaceFile: "book:replaceFile",
  /** The current text of one editable field, for an editor to open on. */
  bookReadField: "book:readField",
  /** Writes a corrected field back into `ocr.json`, byte for byte. */
  bookWriteField: "book:writeField",

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

  /** File and folder pickers. Paths only ever travel *out* of the main process. */
  dialogPickFiles: "dialog:pickFiles",
  dialogPickFolder: "dialog:pickFolder",

  updatesGetState: "updates:getState",
  updatesCheck: "updates:check",
  updatesInstall: "updates:install",
} as const

export const UPDATE_STATUS_EVENT = "updates:status"
/** Main -> renderer: the window was maximized or restored. */
export const WINDOW_MAXIMIZED_EVENT = "window:maximized"
/**
 * Main -> renderer: a file inside one book's folder changed on disk.
 *
 * Carries the uid so the one open book can re-read its page while the library list
 * stays where it is. See `BookChange` in `src/main/library/watch.ts`.
 */
export const BOOK_CHANGED_EVENT = "book:changed"

/** What a `book:changed` payload says. */
export interface BookChangePayload {
  uid: string
  dir: string
  changed: Array<"meta.json" | "ocr.json" | "other">
}

/**
 * A file of a book, named by role rather than by path.
 *
 * The renderer never builds a path: it asks for "the OCR file" and main resolves it
 * from that book's `meta.json` (the OCR file is not always called `ocr.json`).
 */
export type BookFileKind = "folder" | "meta" | "ocr" | "toc" | "pdf" | "cover"

/** Old packages still in the default new-book location, with where they are. */
export interface LeftoverPackages {
  dir: string
  files: string[]
}

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
  | {
      ok: true
      doc: PdfDocument
      alreadyKnown: boolean
      /** The folder had moved and the entry now points at the new place. */
      repointed: boolean
      adopted: boolean
      /** Files this call moved into `.lbook/`, for a one-line report to the reader. */
      moved: string[]
    }
  | { ok: false; error: string }

/**
 * What came of replacing a book's file, or renaming it.
 *
 * `title` is the one role that is not a file: it writes `meta.json` **and** renames the
 * folder to match (A22), so the answer has to be able to say "the name is saved but the
 * folder could not follow" — a partial result, reported as one rather than as a failure.
 */
export interface ReplaceFileResult {
  /** The page count after replacing `ocr.json`. */
  pageCount?: number
  /** The new title, after the `title` role. */
  title?: string
  /** The folder the book lives in now, after a rename. */
  folderName?: string
  /** True when the folder was renamed to follow the title. */
  folderRenamed?: boolean
  /** Set when the title was saved but its folder could not follow. */
  folderProblem?: { code?: string; error: string; detail?: string }
}

/**
 * Which kind of file a picker offers.
 *
 * \`cover\` and \`toc\` are separate from \`json\` because the file dialog's filter is what
 * stops a reader from picking their OCR output as a table of contents.
 */
export type FileKind = "pdf" | "ocr" | "cover" | "toc"

/**
 * The files a new book would be made from, and where it would go.
 *
 * Paths come from a file dialog; nothing here is built by the renderer.
 */
export interface CreateBookInput {
  pdfPath: string
  ocrPath: string
  coverPath?: string | null
  tocPath?: string | null
  title?: string
  /** The folder the book folder is created in. */
  destination: string
}

/**
 * What creating a book would do, worked out before anything is written.
 *
 * The dialog shows this so the reader sees the name and the page count before
 * committing, and gets the reason a set of files will not do rather than an error
 * after the fact.
 */
export type CreateBookPreview =
  | {
      ok: true
      title: string
      dir: string
      folderName: string
      pageCount: number
      ocrBytes: number
      warnings: string[]
    }
  | { ok: false; error: string }

/** A write that either happened or did not; never a half-finished book. */
/**
 * A write that either happened or did not; never a half-finished book.
 *
 * A failure carries a `code` when the message is *ours* — a translation key the
 * interface can render in the reader's language — and only `error` when it is not
 * (a vendor's own words, an `fs` error). The rule comes from I6: we do not translate
 * what a vendor said, but we do translate what we said.
 */
export type WriteOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: string
      code?: string
      /**
       * A value our own message may name, so the translated sentence can be as specific
       * as the English one — "that folder holds a different book (**Oxford**)".
       */
      detail?: string
    }

/** Which of a book's files is being replaced. */
export type ReplaceRole = "ocr" | "cover" | "toc" | "pdf" | "title"

/**
 * The two fields whose *content* can be corrected.
 *
 * Deliberately just two: a block's text and a page's Markdown. Coordinates, labels
 * and structure are not editable — not by rule, but because no code path writes them
 * (`.agents/plan/04-phase4-content-edit.md`).
 */
export type EditableField = "block_content" | "markdown"

/** Maps every channel to its request and response payload types. */
export interface IpcMap {
  [IPC.hello]: { req: void; res: string }

  [IPC.libraryList]: { req: void; res: PdfDocument[] }
  [IPC.libraryGet]: { req: { uid: string }; res: PdfDocument | null }
  [IPC.libraryOpen]: { req: { dir?: string }; res: OpenBookOutcome | null }
  [IPC.libraryRemove]: { req: { uid: string }; res: boolean }
  [IPC.libraryOpenPath]: { req: { uid: string; kind: BookFileKind }; res: void }
  [IPC.libraryShowInFolder]: { req: { uid: string; kind: BookFileKind }; res: void }
  [IPC.libraryInspect]: { req: { uid: string; deep?: boolean }; res: BookIssue[] }
  /** Points an already-listed book at the folder it lives in now. */
  [IPC.libraryLocate]: { req: { uid: string; dir: string }; res: WriteOutcome<PdfDocument> }
  [IPC.libraryLeftovers]: { req: void; res: LeftoverPackages }
  [IPC.libraryOpenLibraryDir]: { req: void; res: void }
  [IPC.libraryRefresh]: { req: void; res: void }
  /** Validates the chosen files and reports what would be created. Writes nothing. */
  [IPC.libraryPreviewBook]: { req: CreateBookInput; res: CreateBookPreview }
  /** Creates the book folder. */
  [IPC.libraryCreateBook]: { req: CreateBookInput; res: WriteOutcome<PdfDocument> }
  /** Replaces one of a book's files, or renames it. */
  [IPC.bookReplaceFile]: {
    req: { uid: string; role: ReplaceRole; value: string }
    res: WriteOutcome<Record<string, unknown>>
  }
  /**
   * The two fields a reader may correct, and the write that corrects them.
   *
   * `pageIndex` is 0-based (the array index, A8); the UI shows `pageIndex + 1`.
   * `baseValue` is what the editor loaded: if the file no longer holds it, the write
   * is refused rather than overwriting somebody else's change.
   */
  [IPC.bookReadField]: {
    req: { uid: string; pageIndex: number; field: EditableField; blockIndex?: number }
    res: WriteOutcome<{ value: string | null }>
  }
  [IPC.bookWriteField]: {
    req: {
      uid: string
      pageIndex: number
      field: EditableField
      blockIndex?: number
      value: string
      baseValue?: string
    }
    res: WriteOutcome<{ charsBefore: number; charsAfter: number; delta: number; pageCount: number }>
  }

  [IPC.dialogPickFiles]: { req: { kind: FileKind }; res: string[] }
  [IPC.dialogPickFolder]: { req: { defaultPath?: string }; res: string | null }

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
    /** Opens a folder or one of its files in whatever the OS uses for it. */
    openPath(uid: string, kind: BookFileKind): Promise<void>
    /** Shows it in the file manager instead, so the reader can see where it lives. */
    showInFolder(uid: string, kind: BookFileKind): Promise<void>
    /**
     * Runs the validation rules. `deep` (the default) also parses every page of the
     * OCR file, which is what finds a page that was edited into a broken state.
     */
    inspect(uid: string, deep?: boolean): Promise<BookIssue[]>
    /** Old `.lbook` packages in the default location, for the one-time-migration hint. */
    leftovers(): Promise<LeftoverPackages>
    /** Opens the default new-book location in the OS file manager. */
    openLibraryDir(): Promise<void>
    /** Validates the chosen files; writes nothing. */
    previewBook(input: CreateBookInput): Promise<CreateBookPreview>
    /** Creates the book folder from those files. */
    createBook(input: CreateBookInput): Promise<WriteOutcome<PdfDocument>>
    /** Re-reads the folders; the window calls this when it regains focus. */
    refresh(): Promise<void>
    /** Points an already-listed book at the folder it lives in now. */
    locate(uid: string, dir: string): Promise<WriteOutcome<PdfDocument>>
  }
  book: {
    getPage(uid: string, pageNum: number): Promise<OcrPage | null>
    readPdfRange(uid: string, begin: number, end: number): Promise<Uint8Array>
    /** The book's table of contents, or null when it has none. */
    getToc(uid: string): Promise<BookToc | null>
    /** Replaces one file, or renames the book. `value` is a path, or the new title. */
    replaceFile(uid: string, role: ReplaceRole, value: string): Promise<WriteOutcome<Record<string, unknown>>>
    /** The current text of an editable field, for an editor to open on. */
    readField(
      uid: string,
      pageIndex: number,
      field: EditableField,
      blockIndex?: number,
    ): Promise<WriteOutcome<{ value: string | null }>>
    /** Writes a corrected field. `baseValue` guards against overwriting a change. */
    writeField(input: {
      uid: string
      pageIndex: number
      field: EditableField
      blockIndex?: number
      value: string
      baseValue?: string
    }): Promise<WriteOutcome<{ charsBefore: number; charsAfter: number; delta: number; pageCount: number }>>
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
  dialog: {
    pickFiles(kind: FileKind): Promise<string[]>
    pickFolder(defaultPath?: string): Promise<string | null>
  }
  updates: {
    getState(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
  }
  events: {
    /** Fires when the library list changes (a book was added or dropped). */
    onLibraryChanged(callback: () => void): () => void
    /** Fires when a file inside one book's folder changed. */
    onBookChanged(callback: (change: BookChangePayload) => void): () => void
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  }
}
