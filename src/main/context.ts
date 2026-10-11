import fs from "node:fs"
import path from "node:path"
import {
  clampReadingFontSize,
  readConfig,
  writeConfig,
  type AppConfig,
  type Theme,
  type TranslateConfig,
} from "./config/config"
import type { LocaleChoice } from "../shared/ipc"
import { createLibrary, type Library } from "./library/library"
import { createLedgerStore } from "./library/ledger"
import { createLibraryWatcher } from "./library/watch"
import { ensureAppDirs, defaultLibraryDir, resolvePaths, type AppPaths } from "./paths"
import { createProgressStore } from "./progress"
import { createTranslateService, type TranslateService } from "./translate/service"

export interface AppContext {
  readonly library: Library
  readonly translate: TranslateService
  readonly config: AppConfig
  paths(): AppPaths
  /** Default new-book location: where the folder picker starts. */
  libraryDir(): string
  isLibraryDirDefault(): boolean
  updateSettings(patch: {
    theme?: Theme
    autoCheckUpdates?: boolean
    readingFontSize?: number
    locale?: LocaleChoice
  }): AppConfig
  /** Persists a new `translate` section; the translate service owns its shape. */
  updateTranslateConfig(translate: TranslateConfig): AppConfig
  /**
   * Moves the default new-book location.
   *
   * Nothing is moved on disk: the ledger holds a path per book, and a book the
   * user put in the old default location keeps working where it is (A11).
   */
  changeLibraryDir(newDir: string): void
  dispose(): void
}

export interface AppContextInput {
  userDataDir: string
  /** `app.getPath('documents')` — the default new-book location. */
  documentsDir: string
}

export function createAppContext(input: AppContextInput): AppContext {
  const { userDataDir, documentsDir } = input
  const configFile = path.join(userDataDir, "config.json")

  let config = readConfig(configFile)
  let libraryRoot = config.libraryDir ?? defaultLibraryDir(documentsDir)

  const paths = () => resolvePaths({ userDataDir, libraryDir: libraryRoot })
  ensureAppDirs(paths())

  const ledgerFile = path.join(userDataDir, "library.json")
  let ledger = createLedgerStore({ file: ledgerFile, root: libraryRoot })
  const progress = createProgressStore({ file: path.join(userDataDir, "progress.json") })
  // Watches the folders in the ledger so an external edit reaches the interface
  // without the reader restarting anything (Phase 2, T1).
  const watcher = createLibraryWatcher()
  const library = createLibrary({ ledger, progress, watcher })

  const persist = (next: AppConfig): AppConfig => {
    config = next
    writeConfig(configFile, config)
    return config
  }

  const translate = createTranslateService({
    getConfig: () => config,
    updateConfig: (next) => {
      persist({ ...config, translate: next })
    },
    paths,
  })

  return {
    library,
    translate,
    get config() {
      return config
    },

    paths,
    libraryDir: () => libraryRoot,
    isLibraryDirDefault: () => config.libraryDir === null,

    updateSettings(patch) {
      return persist({
        ...config,
        ...patch,
        // Clamped here rather than at the IPC edge: this is the only writer of the
        // stored shape, so no caller can put an off-scale size into the file.
        ...(patch.readingFontSize === undefined
          ? {}
          : { readingFontSize: clampReadingFontSize(patch.readingFontSize) }),
      })
    },

    updateTranslateConfig(next) {
      return persist({ ...config, translate: next })
    },

    changeLibraryDir(newDir) {
      libraryRoot = path.resolve(newDir)
      fs.mkdirSync(libraryRoot, { recursive: true })
      config = { ...config, libraryDir: libraryRoot }
      writeConfig(configFile, config)

      // The ledger stores paths *inside* the root relative to it, so a new root
      // changes how every entry is spelled. Rebuilt from the same file, with the
      // new root, and written back once.
      ledger = createLedgerStore({ file: ledgerFile, root: libraryRoot })
    },

    dispose() {
      translate.dispose()
      library.dispose()
    },
  }
}
