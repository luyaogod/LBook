import fs from "node:fs"
import path from "node:path"

/**
 * Every filesystem location the app needs, resolved in one place.
 *
 * `app.getPath()` is called exactly once, in `src/main/index.ts`, and the result
 * is passed down through this type. Everything below the main entry point takes
 * paths as arguments, which is what lets the library and OCR modules be unit-tested
 * under plain Node without launching Electron.
 *
 * Two rules keep this honest:
 *   1. nothing outside this module builds an app path by concatenating strings;
 *   2. anything the app writes is either user data (never deleted by the app) or
 *      regenerable cache (safe to delete at any time).
 */
export interface AppPaths {
  /** %APPDATA%\LBook — config and database live here, never in the library. */
  userDataDir: string
  /** Default location for a new book folder (and where the folder picker starts). */
  libraryDir: string
  databaseFile: string
  configFile: string
  /** Regenerable data. Deleting this directory must never lose user work. */
  cacheDir: string
  /** Translation memory: vendor calls cost money, so answers are kept. */
  translateCacheFile: string
  /** Scratch space the app owns (synthesized audio, exports in progress). */
  tempDir: string
}

export interface AppPathInputs {
  userDataDir: string
  libraryDir: string
}

export function resolvePaths({ userDataDir, libraryDir }: AppPathInputs): AppPaths {
  const cacheDir = path.join(userDataDir, "cache")
  return {
    userDataDir,
    libraryDir,
    databaseFile: path.join(userDataDir, "lbook.db"),
    configFile: path.join(userDataDir, "config.json"),
    cacheDir,
    translateCacheFile: path.join(cacheDir, "translate-cache.json"),
    tempDir: path.join(userDataDir, "temp"),
  }
}

/** Creates the directories the app expects to write into. Idempotent. */
export function ensureAppDirs(paths: AppPaths): void {
  for (const dir of [paths.userDataDir, paths.libraryDir, paths.cacheDir, paths.tempDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** Default library location, used when config.json has no override. */
export function defaultLibraryDir(documentsDir: string): string {
  return path.join(documentsDir, "LBook Library")
}
