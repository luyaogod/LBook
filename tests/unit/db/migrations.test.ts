import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CURRENT_SCHEMA_VERSION, migrate } from "../../../src/main/db/migrate"
import { openDatabase, type Db } from "../../../src/main/db/open"

let open: Db | undefined
let dir: string | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/** Opens a fresh database in a temp dir and tracks it for teardown. */
function freshDatabase(): Db {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-migrate-"))
  open = openDatabase(path.join(dir, "lbook.db"))
  return open
}

describe("migrate", () => {
  it("upgrades a fresh database to the current version", () => {
    const db = freshDatabase()
    expect(db.pragma("user_version", { simple: true })).toBe(0)

    expect(migrate(db)).toBe(CURRENT_SCHEMA_VERSION)
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("is idempotent", () => {
    const db = freshDatabase()
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
    expect(migrate(db)).toBe(CURRENT_SCHEMA_VERSION)
  })

  it("preserves existing data when re-run", () => {
    const db = freshDatabase()
    migrate(db)
    db.prepare(
      `INSERT INTO users (username, created_at) VALUES ('admin', '2026-01-01T00:00:00.000Z')`,
    ).run()

    migrate(db)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM users`).get()).toEqual({ n: 1 })
  })

  it("refuses a database written by a newer build", () => {
    const db = freshDatabase()
    migrate(db)
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`)

    expect(() => migrate(db)).toThrow(/newer than this build/)
  })
})
