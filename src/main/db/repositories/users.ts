import type { User } from "../../../shared/types"
import type { Db } from "../open"

/** The app is single-user; every session resolves to this account. */
export const ADMIN_USERNAME = "admin"

export function createUserRepo(db: Db) {
  return {
    getOrCreateAdmin(createdAt: string): User {
      const existing = db
        .prepare(`SELECT id, username, created_at FROM users WHERE username = ?`)
        .get(ADMIN_USERNAME) as User | undefined
      if (existing) return existing

      const result = db
        .prepare(`INSERT INTO users (username, created_at) VALUES (?, ?)`)
        .run(ADMIN_USERNAME, createdAt)

      return { id: Number(result.lastInsertRowid), username: ADMIN_USERNAME, created_at: createdAt }
    },
  }
}

export type UserRepo = ReturnType<typeof createUserRepo>
