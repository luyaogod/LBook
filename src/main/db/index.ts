import { migrate } from "./migrate"
import { openDatabase, type Db } from "./open"
import { createBlockRepo, type BlockRepo } from "./repositories/blocks"
import { createDocumentRepo, type DocumentRepo } from "./repositories/documents"
import { createPageRepo, type PageRepo } from "./repositories/pages"
import { createProgressRepo, type ProgressRepo } from "./repositories/progress"
import { createUserRepo, type UserRepo } from "./repositories/users"

export type { Db }

export interface Repositories {
  db: Db
  documents: DocumentRepo
  pages: PageRepo
  blocks: BlockRepo
  users: UserRepo
  progress: ProgressRepo
}

/**
 * Builds the repository set over an open handle.
 *
 * Repositories are plain closures over the handle and never import `electron`,
 * which is what lets the whole data layer be tested under plain Node.
 */
export function createRepositories(db: Db): Repositories {
  return {
    db,
    documents: createDocumentRepo(db),
    pages: createPageRepo(db),
    blocks: createBlockRepo(db),
    users: createUserRepo(db),
    progress: createProgressRepo(db),
  }
}

/** Opens the database, brings it up to date, and returns the repository set. */
export function openDatabaseWithRepositories(databaseFile: string): Repositories {
  const db = openDatabase(databaseFile)
  migrate(db)
  return createRepositories(db)
}

export function nowIso(): string {
  return new Date().toISOString()
}
