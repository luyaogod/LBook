import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createLedgerStore } from "../src/main/library/ledger"
import { createLibrary } from "../src/main/library/library"
import { replaceBookFile } from "../src/main/library/create"
import { createProgressStore } from "../src/main/progress"

/**
 * Does a "locate" leave the real library list intact?
 *
 * `library.json` is the only thing here that is not the user's own data, and a botched
 * rewrite loses the library. The unit tests cover the rule with fixtures; this runs it
 * against the **real** file — the real uids, the real mix of relative and absolute paths —
 * on copies. Nothing in the real library is written or moved.
 *
 * It also covers the failure that this check found the first time it ran: the ledger was
 * rewritten before the folder was read, so a half-copied folder left the book pointing
 * somewhere unreadable.
 *
 * And it covers renaming (A22): the folder follows the title, the ledger follows the folder,
 * and when a file inside the folder is held open — which on Windows makes the rename fail —
 * the title is still saved and the partial result is reported as partial.
 */

const APPDATA = process.env.APPDATA ?? ""
const REAL_LEDGER = path.join(APPDATA, "LBook", "library.json")
const work = path.join(os.tmpdir(), "lbook-locate-e2e")

function libraryRoot(): string {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(APPDATA, "LBook", "config.json"), "utf8")) as {
      libraryDir?: string | null
    }
    if (config.libraryDir) return config.libraryDir
  } catch {
    // The default in src/main/paths.ts.
  }
  return path.join(os.homedir(), "Documents", "LBook Library")
}

function main(): void {
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })

  const before = fs.readFileSync(REAL_LEDGER, "utf8")
  const parsed = JSON.parse(before) as { books: Array<{ path: string; uid: string }> }
  console.log(`real ledger: ${parsed.books.length} books, root ${libraryRoot()}`)

  const ledgerFile = path.join(work, "library.json")
  fs.writeFileSync(ledgerFile, before)

  // The real ledger, read through the real store — so `resolve()` (not my own path
  // arithmetic) says where each book actually is.
  const reader = createLedgerStore({ file: ledgerFile, root: libraryRoot() })
  const refs = reader.list()
  const index = refs.findIndex((ref) => fs.existsSync(path.join(reader.resolve(ref), ".lbook", "ocr.json")))
  const target = refs[index]
  if (target === undefined) {
    console.error("no listed book has a readable .lbook/ — nothing to locate")
    process.exitCode = 1
    return
  }
  const real = reader.resolve(target)
  const size = (fs.statSync(path.join(real, ".lbook", "ocr.json")).size / 1048576).toFixed(1)
  console.log(`using "${path.basename(real)}" (${size}MB of OCR)\n`)

  const library = createLibrary({
    ledger: createLedgerStore({ file: ledgerFile, root: libraryRoot() }),
    progress: createProgressStore({ file: path.join(work, "progress.json") }),
    now: () => "2026-10-11T00:00:00.000Z",
  })

  // Where the book lives now: a full copy of its metadata folder, minus the PDF (which
  // `describe` only reports on, and which is 100MB+ for some books).
  const moved = path.join(work, "moved", path.basename(real))
  fs.mkdirSync(path.join(moved, ".lbook"), { recursive: true })
  for (const file of ["meta.json", "ocr.json"]) {
    fs.copyFileSync(path.join(real, ".lbook", file), path.join(moved, ".lbook", file))
  }

  // Half of the same book, for the refusal that has to leave the ledger alone.
  const half = path.join(work, "half", path.basename(real))
  fs.mkdirSync(path.join(half, ".lbook"), { recursive: true })
  fs.copyFileSync(path.join(real, ".lbook", "meta.json"), path.join(half, ".lbook", "meta.json"))

  const read = () => {
    const text = fs.readFileSync(ledgerFile, "utf8")
    return { text, books: (JSON.parse(text) as { books: Array<{ path: string; uid: string }> }).books }
  }
  const start = read()
  const others = (books: Array<{ path: string; uid: string }>) =>
    JSON.stringify(books.filter((book) => book.uid !== target.uid))

  void (async () => {
    const refused = await library.relocate(target.uid, half)
    const afterRefusal = read()

    const outcome = await library.relocate(target.uid, moved)
    const after = read()
    const doc = await library.get(target.uid)
    const page = await library.getPage(target.uid, 2)

    const checks: Array<[string, boolean, string]> = [
      [
        "a half-copied folder is refused, naming the missing file",
        !refused.ok && refused.code === "message.relocate.missingOcr",
        refused.ok ? "" : String(refused.code),
      ],
      [
        "the refusal left the ledger exactly as it was",
        afterRefusal.text === start.text,
        `${afterRefusal.books.length} books`,
      ],
      ["the locate succeeds on a complete folder", outcome.ok, outcome.ok ? "" : outcome.error],
      ["the ledger still lists the same books", after.books.length === start.books.length, ""],
      ["only the located book's path changed", others(start.books) === others(after.books), ""],
      [
        "the located book points at the folder given",
        path.resolve(after.books[index]?.path ?? "") === moved,
        after.books[index]?.path ?? "(none)",
      ],
      [
        "no duplicate rows for that uid",
        after.books.filter((book) => book.uid === target.uid).length === 1,
        "",
      ],
      ["the book reads back from the new place", doc?.uid === target.uid, doc?.dir ?? "(null)"],
      ["and a page reads too", page?.page_num === 2, `page ${page?.page_num ?? "?"}`],
      ["the real library.json was not touched", fs.readFileSync(REAL_LEDGER, "utf8") === before, ""],
    ]

    // ---- renaming: the folder follows the title (A22) -----------------------------
    const renamed = await replaceBookFile(library, target.uid, "title", "改名后的书名")
    const afterRename = read()
    const renamedDir = path.join(path.dirname(moved), "改名后的书名")

    let blocked: Awaited<ReturnType<typeof replaceBookFile>> | null = null
    const held = path.join(renamedDir, "book.pdf")
    if (fs.existsSync(renamedDir)) {
      // A file held open inside the folder makes the rename fail on Windows — measured,
      // and the realistic case (something is sitting on a file in there).
      fs.writeFileSync(held, "%PDF-1.4", "utf8")
      const handle = fs.openSync(held, "r")
      try {
        blocked = await replaceBookFile(library, target.uid, "title", "这次改不动")
      } finally {
        fs.closeSync(handle)
      }
    }

    checks.push(
      ["renaming moves the folder", renamed.ok && fs.existsSync(renamedDir), renamed.ok ? "" : renamed.error],
      [
        "the ledger followed the folder, one row per book",
        afterRename.books.length === start.books.length &&
          path.basename(afterRename.books[index]?.path ?? "") === "改名后的书名" &&
          afterRename.books.filter((book) => book.uid === target.uid).length === 1,
        path.basename(afterRename.books[index]?.path ?? ""),
      ],
      [
        "the uid survived, so progress did not move",
        afterRename.books[index]?.uid === target.uid,
        (await library.progress.get(target.uid)) === null ? "no progress stored" : "progress intact",
      ],
      [
        "a folder held open is reported, and the name is still saved",
        blocked === null
          ? false
          : blocked.ok && blocked.value.folderProblem !== undefined && blocked.value.folderRenamed === false,
        blocked === null || !blocked.ok ? "could not even try" : String(blocked.value.folderProblem?.code ?? "no problem reported"),
      ],
      ["the real library.json is still untouched", fs.readFileSync(REAL_LEDGER, "utf8") === before, ""],
    )



    console.log("")
    let failed = 0
    for (const [what, ok, detail] of checks) {
      if (!ok) failed++
      console.log(`  ${ok ? "✓" : "✗"} ${what}${detail === "" ? "" : `  — ${detail}`}`)
    }
    console.log(`\n  ${path.basename(real)}: ${start.books[index]?.path}\n    → ${after.books[index]?.path}`)
    fs.rmSync(work, { recursive: true, force: true })
    if (failed > 0) process.exitCode = 1
  })()
}

main()
