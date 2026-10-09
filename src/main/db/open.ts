import Database from "better-sqlite3"
import fs from "node:fs"
import path from "node:path"

export type Db = Database.Database

/**
 * Opens (creating if needed) the SQLite database and applies the pragmas the
 * schema depends on.
 *
 * `foreign_keys` is the important one: SQLite defaults it OFF, and the schema
 * relies on ON DELETE CASCADE. Without it, deleting a document would silently
 * orphan its pages and tens of thousands of blocks.
 */
export function openDatabase(databaseFile: string): Db {
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true })

  const db = new Database(databaseFile)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.pragma("synchronous = NORMAL")
  db.pragma("busy_timeout = 5000")

  return db
}
