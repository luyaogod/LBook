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
import { openDatabaseWithRepositories, type Repositories } from "./db"
import { closeAllArchives } from "./lbook/archiveCache"
import { LBOOK_EXTENSION } from "./lbook/manifest"
import { createLibraryService, type LibraryService } from "./library/service"
import { ensureAppDirs, defaultLibraryDir, resolvePaths, type AppPaths } from "./paths"
import { createTranslateService, type TranslateService } from "./translate/service"

export interface AppContext {
  readonly repos: Repositories
  readonly library: LibraryService
  readonly translate: TranslateService
  readonly config: AppConfig
  paths(): AppPaths
  libraryDir(): string
  isLibraryDirDefault(): boolean
  updateSettings(patch: {
    theme?: Theme
    autoCheckUpdates?: boolean
    readingFontSize?: number
  }): AppConfig
  /** Persists a new `translate` section; the translate service owns its shape. */
  updateTranslateConfig(translate: TranslateConfig): AppConfig
  /** Moves every package to `newDir`, repoints the index, then persists config. */
  changeLibraryDir(newDir: string): Promise<void>
  dispose(): Promise<void>
}

export interface AppContextInput {
  userDataDir: string
  /** `app.getPath('documents')` — the default library location. */
  documentsDir: string
}

export function createAppContext(input: AppContextInput): AppContext {
  const { userDataDir, documentsDir } = input
  const configFile = path.join(userDataDir, "config.json")

  let config = readConfig(configFile)
  let libraryDir = config.libraryDir ?? defaultLibraryDir(documentsDir)

  const paths = () => resolvePaths({ userDataDir, libraryDir })
  ensureAppDirs(paths())

  const repos = openDatabaseWithRepositories(path.join(userDataDir, "lbook.db"))
  const library = createLibraryService({ repos, getLibraryDir: () => libraryDir })

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
    repos,
    library,
    translate,
    get config() {
      return config
    },

    paths,
    libraryDir: () => libraryDir,
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

    async changeLibraryDir(newDir) {
      const target = path.resolve(newDir)
      if (target === path.resolve(libraryDir)) {
        config = { ...config, libraryDir: target }
        writeConfig(configFile, config)
        return
      }

      fs.mkdirSync(target, { recursive: true })

      // Release every open handle first: Windows will not move a file that is
      // still open, and closing is asynchronous.
      await closeAllArchives()

      for (const row of repos.documents.listRows()) {
        const source = row.file_path
        if (!fs.existsSync(source)) continue

        const destination = path.join(target, row.relative_path)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.renameSync(source, destination)
        repos.documents.updateLocation(row.id, {
          file_path: destination,
          relative_path: row.relative_path,
        })
      }

      // Packages sitting directly in the old folder that the index does not know
      // about still belong to the user, so bring them along.
      if (fs.existsSync(libraryDir)) {
        for (const name of fs.readdirSync(libraryDir)) {
          if (!name.toLowerCase().endsWith(LBOOK_EXTENSION)) continue
          fs.renameSync(path.join(libraryDir, name), path.join(target, name))
        }
      }

      libraryDir = target
      config = { ...config, libraryDir: target }
      writeConfig(configFile, config)
    },

    async dispose() {
      translate.dispose()
      await closeAllArchives()
      repos.db.close()
    },
  }
}
