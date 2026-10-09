/**
 * One-off migration: legacy backend/lbook.db + backend/uploads -> .lbook packages.
 *
 *   npm run migrate:legacy -- [--dry-run] [--legacy <dir>] [--library <dir>]
 *
 * The legacy database is opened READ-ONLY and never modified. Each book is
 * packed into the library folder and then indexed through the very same import
 * path the app uses, so the two can never drift apart.
 */
import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { nowIso, openDatabaseWithRepositories } from "../src/main/db"
import {
  readLegacyDocuments,
  readLegacyProgress,
  reconstructLegacyBook,
  type LegacyDocument,
} from "../src/main/library/legacy"
import { importPackage } from "../src/main/library/importer"
import { packageFileName } from "../src/main/lbook/manifest"
import { packLbook } from "../src/main/lbook/packer"

interface MigrationReport {
  startedAt: string
  legacyDir: string
  libraryDir: string
  dryRun: boolean
  books: Array<{
    legacyId: number
    title: string
    uid?: string
    package?: string
    pages?: number
    blocks?: number
    pdfBytes?: number
    status: "packed" | "skipped" | "failed"
    note?: string
  }>
  progressRestored: number
  finishedAt?: string
}

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")

function argValue(flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const legacyDir = path.resolve(argValue("--legacy") ?? "backend")
const libraryDir = path.resolve(
  argValue("--library") ?? path.join(os.homedir(), "Documents", "LBook Library"),
)

function appDataDir(): string {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming")
  return path.join(appData, "LBook")
}

/** Normalizes the legacy "YYYY-MM-DD HH:MM:SS.ffffff" UTC stamp to ISO 8601. */
function toIso(value: string | null): string {
  if (!value) return nowIso()
  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`
}

function requireSource(doc: LegacyDocument): fs.Stats {
  if (!fs.existsSync(doc.file_path)) {
    throw new Error(`source PDF missing: ${doc.file_path}`)
  }
  const stats = fs.statSync(doc.file_path)
  if (stats.size !== doc.file_size) {
    throw new Error(`size mismatch (db ${doc.file_size}, disk ${stats.size})`)
  }
  return stats
}

async function main(): Promise<void> {
  const legacyFile = path.join(legacyDir, "lbook.db")
  if (!fs.existsSync(legacyFile)) throw new Error(`Legacy database not found: ${legacyFile}`)

  console.log(`legacy   ${legacyFile}`)
  console.log(`library  ${libraryDir}`)
  console.log(dryRun ? "mode     DRY RUN (nothing will be written)\n" : "")

  const report: MigrationReport = {
    startedAt: nowIso(),
    legacyDir,
    libraryDir,
    dryRun,
    books: [],
    progressRestored: 0,
  }

  // Read-only: this database is the only copy of the data.
  const legacy = new Database(legacyFile, { readonly: true, fileMustExist: true })
  const documents = readLegacyDocuments(legacy)
  const progress = readLegacyProgress(legacy)

  if (!dryRun) fs.mkdirSync(libraryDir, { recursive: true })

  const repos = dryRun ? null : openDatabaseWithRepositories(path.join(appDataDir(), "lbook.db"))
  const idMap = new Map<number, number>()

  for (const doc of documents) {
    const entry: MigrationReport["books"][number] = {
      legacyId: doc.id,
      title: doc.file_name,
      status: "skipped",
    }
    report.books.push(entry)

    let stats: fs.Stats
    try {
      stats = requireSource(doc)
    } catch (error) {
      entry.status = "failed"
      entry.note = error instanceof Error ? error.message : String(error)
      console.error(`  #${doc.id} ${doc.file_name}: ${entry.note}`)
      continue
    }

    const book = reconstructLegacyBook(legacy, doc)
    entry.pages = book.pages
    entry.blocks = book.blocks
    entry.pdfBytes = stats.size

    if (dryRun) {
      entry.status = "packed"
      console.log(
        `  #${doc.id} ${doc.file_name}: would pack ${book.pages} pages / ${book.blocks} blocks ` +
          `(${(stats.size / 1024 / 1024).toFixed(1)} MB)`,
      )
      continue
    }

    const uid = randomUUID().replace(/-/g, "")
    const outputPath = path.join(libraryDir, packageFileName(doc.file_name, uid))
    const coverPath = doc.cover_path && fs.existsSync(doc.cover_path) ? doc.cover_path : null

    try {
      await packLbook({
        pdfPath: doc.file_path,
        ocrJson: book.json,
        coverPath,
        uid,
        title: doc.file_name,
        author: null,
        createdAt: toIso(doc.created_at),
        pageCount: book.pages,
        outputPath,
      })

      const outcome = await importPackage(repos!, libraryDir, outputPath, { force: true })
      idMap.set(doc.id, outcome.pdfId)

      entry.uid = uid
      entry.package = path.basename(outputPath)
      entry.status = "packed"
      console.log(
        `  #${doc.id} ${doc.file_name}: ${book.pages} pages / ${book.blocks} blocks -> ${entry.package}`,
      )
    } catch (error) {
      entry.status = "failed"
      entry.note = error instanceof Error ? error.message : String(error)
      console.error(`  #${doc.id} ${doc.file_name}: FAILED - ${entry.note}`)
    }
  }

  if (!dryRun && repos) {
    const user = repos.users.getOrCreateAdmin(nowIso())
    for (const row of progress) {
      const newId = idMap.get(row.pdf_id)
      if (newId === undefined) continue
      const saved = repos.progress.save(user.id, newId, row.last_page_num, toIso(row.updated_at))
      if (saved) report.progressRestored += 1
    }
    repos.db.close()
  }

  legacy.close()
  report.finishedAt = nowIso()

  const reportPath = path.resolve("migration-report.json")
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")

  const packed = report.books.filter((b) => b.status === "packed").length
  const failed = report.books.filter((b) => b.status === "failed").length
  console.log(
    `\n${packed} packed, ${failed} failed, ${report.progressRestored} progress rows restored`,
  )
  console.log(`report   ${reportPath}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
