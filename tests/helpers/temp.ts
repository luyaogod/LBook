import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { openDatabaseWithRepositories, type Repositories } from "../../src/main/db"

export interface TestContext {
  dir: string
  databaseFile: string
  repos: Repositories
  cleanup(): void
}

/**
 * Creates an isolated database under the OS temp dir.
 * Tests must never touch the real %APPDATA%\LBook.
 */
export function createTestContext(): TestContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-test-"))
  const databaseFile = path.join(dir, "lbook.db")
  const repos = openDatabaseWithRepositories(databaseFile)

  return {
    dir,
    databaseFile,
    repos,
    cleanup() {
      repos.db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Isolated library folder plus an initialised repository set. */
export interface LibraryTestContext extends TestContext {
  libraryDir: string
}

export function createLibraryTestContext(): LibraryTestContext {
  const context = createTestContext()
  const libraryDir = path.join(context.dir, "library")
  fs.mkdirSync(libraryDir, { recursive: true })
  return { ...context, libraryDir }
}

let docCounter = 0

/** Inserts a document with sensible defaults; override only what the test cares about. */
export function insertDocument(
  repos: Repositories,
  overrides: Partial<Parameters<Repositories["documents"]["insert"]>[0]> = {},
): number {
  docCounter += 1

  const base: Parameters<Repositories["documents"]["insert"]>[0] = {
    uid: `uid-${docCounter}`,
    file_name: `book-${docCounter}.pdf`,
    author: null,
    file_path: "/library/book.lbook",
    relative_path: "book.lbook",
    file_hash: `hash-${docCounter}`,
    page_count: 10,
    file_size: 1024,
    file_mtime: 0,
    data_info: null,
    cover_path: null,
    created_at: new Date(Date.UTC(2026, 0, docCounter)).toISOString(),
  }

  // `base` supplies every required field, so the spread can only ever replace
  // a value that is already present.
  return repos.documents.insert({ ...base, ...overrides } as typeof base)
}
