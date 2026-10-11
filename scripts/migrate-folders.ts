/**
 * One-time migration: every `.lbook` in the library → a book folder.
 *
 *   npm run migrate:folders                       # dry run first, always
 *   npm run migrate:folders -- --dry-run          # the same thing, spelled out
 *   npm run migrate:folders -- --apply            # actually write
 *   npm run migrate:folders -- --book 经济法        # one book, by file-name fragment
 *   npm run migrate:folders -- --root <dir>       # another library directory
 *
 * What it does per package: build a folder next to the final name, stream
 * `book.pdf` out (hashing it against the package's own `pdfSha256`), copy
 * `ocr.json` byte for byte, copy `toc.json` and the cover if they are there, write
 * `meta.json`, verify the page count, and rename the folder into place. Then it
 * registers the book in `library.json` and carries the reading position over from
 * the old `lbook.db`.
 *
 * **Nothing is written unless `--apply` is passed**, and the old packages are never
 * moved, renamed or deleted — running this twice is a no-op, because a book that is
 * already registered is skipped.
 *
 * Progress is the one thing read from the old database, and this is the last code
 * in the repository that touches SQLite. Once the migration is verified, this file,
 * `src/main/migrate/` and the `better-sqlite3` devDependency can all be deleted
 * (`.agents/plan/03-phase3-drop-sqlite.md`).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { readConfig } from "../src/main/config/config"
import { createLedgerStore } from "../src/main/library/ledger"
import { migratePackage, type MigrateOutcome } from "../src/main/migrate/lbookToFolder"
import { LBOOK_EXTENSION } from "../src/main/migrate/manifest"
import { defaultLibraryDir } from "../src/main/paths"
import { createProgressStore } from "../src/main/progress"

interface Row {
  file: string
  outcome: MigrateOutcome
  progress?: { page: number; saved: boolean; note?: string }
}

function size(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)}MB`
}

async function main(): Promise<void> {
  const userDataDir = path.join(
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
    "LBook",
  )
  const documentsDir = path.join(os.homedir(), "Documents")

  const argv = process.argv.slice(2)
  const take = (flag: string): string | undefined =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined

  const apply = argv.includes("--apply")
  const bookFilter = take("--book")

  const config = readConfig(path.join(userDataDir, "config.json"))
  const libraryRoot = path.resolve(
    take("--root") ?? config.libraryDir ?? defaultLibraryDir(documentsDir),
  )
  const ledgerFile = path.join(userDataDir, "library.json")
  const progressFile = path.join(userDataDir, "progress.json")
  const databaseFile = path.join(userDataDir, "lbook.db")

  const ledger = createLedgerStore({ file: ledgerFile, root: libraryRoot })
  const progress = createProgressStore({ file: progressFile })

  console.log(`library      ${libraryRoot}`)
  console.log(`ledger       ${ledgerFile}`)
  console.log(`progress     ${progressFile}`)
  console.log(`mode         ${apply ? "APPLY (writing books)" : "dry run (nothing is written)"}\n`)

  for (const issue of ledger.issues) console.warn(`library.json: ${issue}`)

  // ---- the packages to convert -------------------------------------------

  let names: string[]
  try {
    names = fs.readdirSync(libraryRoot)
  } catch {
    console.error(`cannot read ${libraryRoot}`)
    process.exitCode = 1
    return
  }

  const packages = names
    .filter((name) => name.toLowerCase().endsWith(LBOOK_EXTENSION))
    .filter((name) => (bookFilter ? name.includes(bookFilter) : true))
    .map((name) => path.join(libraryRoot, name))
    .sort()

  if (packages.length === 0) {
    console.log(bookFilter ? `no .lbook matching "${bookFilter}"` : "no .lbook to migrate")
    return
  }

  console.log(`${packages.length} package(s):`)
  for (const file of packages) console.log(`  ${path.basename(file)}`)
  console.log()

  // ---- reading positions from the old database ---------------------------

  /**
   * `uid → page`, from the old index.
   *
   * Opened read-only, and only if it exists: a machine that never had an index
   * simply migrates without progress. The join goes through `pdf_documents`
   * because the progress table was keyed by row id, and the uid is the part that
   * survives.
   */
  function readLegacyProgress(): Map<string, number> {
    const positions = new Map<string, number>()
    if (!fs.existsSync(databaseFile)) return positions

    const db = new Database(databaseFile, { readonly: true, fileMustExist: true })
    try {
      const rows = db
        .prepare(
          `SELECT d.uid AS uid, MAX(p.last_page_num) AS page
             FROM reading_progress p
             JOIN pdf_documents d ON d.id = p.pdf_id
            GROUP BY d.uid`,
        )
        .all() as Array<{ uid: string; page: number }>
      for (const row of rows) positions.set(row.uid, row.page)
    } catch (error) {
      console.warn(`could not read reading progress: ${(error as Error).message}`)
    } finally {
      db.close()
    }
    return positions
  }

  const legacyProgress = readLegacyProgress()
  console.log(`reading positions in the old index: ${legacyProgress.size}\n`)

  // ---- migrate ------------------------------------------------------------

  const rows: Row[] = []

  for (const file of packages) {
    // Rebuilt each round: the previous book is now registered, so a package whose
    // title would collide with it (or that was migrated a moment ago) is seen.
    const registered = new Map(ledger.list().map((ref) => [ref.uid, ledger.resolve(ref)] as const))
    const outcome = await migratePackage({
      packagePath: file,
      targetRoot: libraryRoot,
      registered,
      dryRun: !apply,
    })

    const row: Row = { file, outcome }

    if (apply && outcome.status === "migrated") {
      ledger.add(outcome.dir, outcome.uid)

      const page = legacyProgress.get(outcome.uid)
      if (page !== undefined) {
        if (page >= 1 && page <= outcome.pageCount) {
          progress.save(outcome.uid, page)
          row.progress = { page, saved: true }
        } else {
          // The OCR file has fewer pages than the position recorded against it, so
          // the position is dropped rather than clamped: the book opens at page 1
          // instead of at a page that does not exist.
          row.progress = { page, saved: false, note: `outside 1..${outcome.pageCount}` }
        }
      }
    }

    rows.push(row)
  }

  // ---- report -------------------------------------------------------------

  let skipped = 0
  let failed = 0

  for (const { file, outcome, progress: position } of rows) {
    const name = path.basename(file)
    switch (outcome.status) {
      case "migrated": {
        const moved =
          outcome.pageCount !== outcome.manifestPageCount
            ? ` (manifest said ${outcome.manifestPageCount})`
            : ""
        console.log(`✓ ${name}`)
        console.log(
          `    → ${path.basename(outcome.dir)}  pdf ${size(outcome.pdfBytes)} sha256 ${outcome.pdfSha256.slice(0, 12)}…  ocr ${size(outcome.ocrBytes)}  ${outcome.pageCount} pages${moved}`,
        )
        console.log(
          `    toc ${outcome.hasToc ? "yes" : "no"}  cover ${outcome.hasCover ? "yes" : "no"}  ${outcome.elapsedMs.toFixed(0)}ms${position ? `  progress ${position.saved ? position.page : `${position.page} (${position.note ?? "dropped"})`}` : ""}`,
        )
        break
      }
      case "planned":
        console.log(`· ${name}`)
        console.log(
          `    → ${path.basename(outcome.dir)}  pdf ${size(outcome.pdfBytes)}  manifest says ${outcome.manifestPageCount} pages`,
        )
        break
      case "skipped":
        skipped += 1
        console.log(`= ${name}\n    skipped: ${outcome.reason}`)
        break
      case "failed":
        failed += 1
        console.log(`✗ ${name}\n    ${outcome.error}`)
        break
    }
  }

  const written = rows.filter((r) => r.outcome.status === (apply ? "migrated" : "planned")).length
  console.log(
    `\n${apply ? "migrated" : "would migrate"}: ${written}  skipped: ${skipped}  failed: ${failed}`,
  )
  if (!apply) console.log("dry run: nothing was written. Re-run with --apply to do it for real.")
  if (failed > 0) process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
