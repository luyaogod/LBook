import type { Db } from "./open"
import { SCHEMA_V1 } from "./schema"

/**
 * Append-only migration list, driven by `PRAGMA user_version`.
 *
 * Never edit an entry that has shipped — add a new one. `MIGRATIONS[n]` upgrades
 * a database from version n to n+1.
 */
const MIGRATIONS: Array<(db: Db) => void> = [(db) => db.exec(SCHEMA_V1)]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length

/** Brings the database up to CURRENT_SCHEMA_VERSION. Returns the new version. */
export function migrate(db: Db): number {
  const from = db.pragma("user_version", { simple: true }) as number

  if (from > MIGRATIONS.length) {
    throw new Error(
      `Database schema v${from} is newer than this build supports (v${MIGRATIONS.length}). ` +
        `Upgrade LBook to open it.`,
    )
  }
  if (from === MIGRATIONS.length) return from

  db.transaction(() => {
    for (let version = from; version < MIGRATIONS.length; version++) {
      MIGRATIONS[version](db)
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`)
  })()

  return MIGRATIONS.length
}
