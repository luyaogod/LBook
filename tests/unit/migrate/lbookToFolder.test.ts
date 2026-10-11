import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { migratePackage } from "../../../src/main/migrate/lbookToFolder"
import { parseBookMeta } from "../../../src/shared/bookFile"
import { buildLbook, fakePdf } from "../../helpers/lbookPackage"

let root: string | undefined

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = undefined
})

function tempRoot(): string {
  root ??= fs.mkdtempSync(path.join(os.tmpdir(), "lbook-migrate-"))
  return root
}

/** A page element, in PaddleOCR's shape. */
function page(n: number): unknown {
  return {
    prunedResult: {
      width: 1224,
      height: 1584,
      parsing_res_list: [{ block_label: "text", block_content: `page ${n}`, block_bbox: [1, 2, 3, 4] }],
    },
    markdown: { text: `### page ${n}`, images: {} },
  }
}

function ocrDocument(pages: number): unknown {
  return {
    layoutParsingResults: Array.from({ length: pages }, (_, i) => page(i + 1)),
    dataInfo: { type: "pdf", numPages: pages, pages: [] },
  }
}

interface Fixture {
  root: string
  libraryRoot: string
  packagePath: string
  pdf: Buffer
}

/** A package plus the library directory it will be migrated into. */
async function fixture(options: {
  title?: string
  uid?: string
  pages?: number
  toc?: unknown | null
  cover?: { name: string; data: Buffer } | null
  pdf?: Buffer
  manifestOverrides?: Record<string, unknown>
} = {}): Promise<Fixture> {
  const base = tempRoot()
  const libraryRoot = path.join(base, "library")
  const packages = path.join(base, "packages")
  fs.mkdirSync(libraryRoot, { recursive: true })
  fs.mkdirSync(packages, { recursive: true })

  const pdf = options.pdf ?? fakePdf()
  const built = await buildLbook({
    dir: packages,
    title: options.title ?? "Test Book",
    uid: options.uid ?? "aaaa1111bbbb2222cccc3333dddd4444",
    pdf,
    ocr: ocrDocument(options.pages ?? 3),
    cover: options.cover ?? null,
    toc: options.toc ?? null,
    manifestOverrides: options.manifestOverrides,
  })

  return { root: base, libraryRoot, packagePath: built.filePath, pdf }
}

function readMeta(dir: string) {
  const parsed = parseBookMeta(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")))
  if (!parsed.ok) throw new Error(`fixture wrote a meta.json this code cannot read: ${parsed.error}`)
  return parsed.meta
}

function foldersIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

describe("migrating one package", () => {
  it("writes a book folder that keeps the package's uid and bytes", async () => {
    const f = await fixture({ title: "经济法基础2024", pages: 4 })

    const outcome = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(outcome.status).toBe("migrated")
    if (outcome.status !== "migrated") return

    const dir = path.join(f.libraryRoot, "经济法基础2024")
    expect(outcome.dir).toBe(dir)
    expect(fs.existsSync(dir)).toBe(true)

    // The identity has to survive: reading progress and cover URLs are keyed by it.
    const meta = readMeta(dir)
    expect(meta.uid).toBe("aaaa1111bbbb2222cccc3333dddd4444")
    expect(meta.title).toBe("经济法基础2024")
    expect(meta.ocrFile).toBe("ocr.json")
    expect(meta.pageCount).toBe(4)

    // book.pdf is copied byte for byte, and the copy is what the manifest claimed.
    const copiedPdf = fs.readFileSync(path.join(dir, "book.pdf"))
    expect(copiedPdf.equals(f.pdf)).toBe(true)
    expect(outcome.pdfSha256).toBe(createHash("sha256").update(f.pdf).digest("hex"))

    // ocr.json is copied verbatim (A7) — same bytes, not a re-serialization.
    const inPackage = await readEntryBytes(f.packagePath, "ocr.json")
    expect(fs.readFileSync(path.join(dir, "ocr.json")).equals(inPackage)).toBe(true)
  })

  it("carries toc.json and the cover across", async () => {
    const cover = { name: "cover.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }
    const f = await fixture({
      toc: { version: 1, nodes: [{ title: "Chapter", page: 1 }] },
      cover,
    })

    const outcome = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(outcome).toMatchObject({ status: "migrated", hasToc: true, hasCover: true })

    const dir = path.join(f.libraryRoot, "Test Book")
    expect(JSON.parse(fs.readFileSync(path.join(dir, "toc.json"), "utf8"))).toMatchObject({
      nodes: [{ title: "Chapter" }],
    })
    // Kept under the name the manifest gave it, which is what makes the protocol
    // serve it as the cover.
    expect(fs.readFileSync(path.join(dir, "cover.png")).equals(cover.data)).toBe(true)
  })

  it("reports a manifest page count that disagrees with the OCR file", async () => {
    // meta.json records the pages that are really there; the lie is reported
    // rather than copied, because the viewer pages through meta.json.
    const f = await fixture({ pages: 5, manifestOverrides: { pageCount: 99 } })

    const outcome = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(outcome).toMatchObject({ status: "migrated", pageCount: 5, manifestPageCount: 99 })
    if (outcome.status !== "migrated") return
    expect(readMeta(outcome.dir).pageCount).toBe(5)
  })

  it("fails loudly when the PDF does not match the package's own hash", async () => {
    const f = await fixture({ manifestOverrides: { pdfSha256: "b".repeat(64) } })

    const outcome = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(outcome).toMatchObject({ status: "failed" })
    if (outcome.status !== "failed") return
    expect(outcome.error).toMatch(/does not match the package's own hash/)

    // Nothing half-written is left behind, and the package is untouched.
    expect(foldersIn(f.libraryRoot)).toEqual([])
    expect(fs.existsSync(f.packagePath)).toBe(true)
  })

  it("fails when the package has no ocr.json", async () => {
    const f = await fixture()
    // Rebuild without the OCR entry by pointing at a package that never had one.
    const bare = await buildLbook({
      dir: path.dirname(f.packagePath),
      title: "No OCR",
      uid: "eeee5555ffff6666aaaa7777bbbb8888",
      pdf: fakePdf(),
      ocr: null,
    })

    const outcome = await migratePackage({ packagePath: bare.filePath, targetRoot: f.libraryRoot })
    expect(outcome).toMatchObject({ status: "failed", error: /no ocr\.json/ })
    expect(foldersIn(f.libraryRoot)).toEqual([])
  })

  it("refuses a package whose OCR file has no pages", async () => {
    const f = await fixture({ pages: 0 })

    const outcome = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(outcome).toMatchObject({ status: "failed", error: /no pages/ })
    expect(foldersIn(f.libraryRoot)).toEqual([])
  })

  it("fails on a file that is not a package at all", async () => {
    const base = tempRoot()
    const notAPackage = path.join(base, "not-a-package.lbook")
    fs.writeFileSync(notAPackage, "definitely not a zip")

    const outcome = await migratePackage({ packagePath: notAPackage, targetRoot: path.join(base, "library") })
    expect(outcome.status).toBe("failed")
  })
})

describe("running it twice", () => {
  it("skips a book that is already in the library", async () => {
    const f = await fixture()
    const first = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(first.status).toBe("migrated")
    if (first.status !== "migrated") return

    const registered = new Map([[first.uid, first.dir]])
    const second = await migratePackage({
      packagePath: f.packagePath,
      targetRoot: f.libraryRoot,
      registered,
    })
    expect(second).toMatchObject({ status: "skipped", reason: "already in the library", dir: first.dir })

    // And no second copy appeared.
    expect(foldersIn(f.libraryRoot)).toEqual([path.basename(first.dir)])
  })

  it("recognises its own folder even with an empty ledger", async () => {
    // What a re-run looks like after the ledger was lost: the folder's meta.json
    // already carries this uid, so this is the same book rather than a collision.
    const f = await fixture()
    const first = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(first.status).toBe("migrated")

    const second = await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })
    expect(second).toMatchObject({ status: "skipped", reason: "this folder already holds this book" })
    expect(foldersIn(f.libraryRoot)).toHaveLength(1)
  })

  it("gives a different book a numbered folder instead of overwriting", async () => {
    const f = await fixture({ title: "Same Title", uid: "11112222333344445555666677778888" })
    expect((await migratePackage({ packagePath: f.packagePath, targetRoot: f.libraryRoot })).status).toBe(
      "migrated",
    )

    const other = await buildLbook({
      dir: path.dirname(f.packagePath),
      title: "Same Title",
      uid: "99998888777766665555444433332222",
      pdf: fakePdf(8192),
      ocr: ocrDocument(2),
    })

    const second = await migratePackage({ packagePath: other.filePath, targetRoot: f.libraryRoot })
    expect(second).toMatchObject({ status: "migrated" })
    if (second.status !== "migrated") return
    expect(path.basename(second.dir)).toBe("Same Title-2")
    // The first book is still there, untouched.
    expect(readMeta(path.join(f.libraryRoot, "Same Title")).uid).toBe(
      "11112222333344445555666677778888",
    )
  })
})

describe("dry run", () => {
  it("plans without writing anything", async () => {
    const f = await fixture({ title: "Planned", pages: 7 })

    const outcome = await migratePackage({
      packagePath: f.packagePath,
      targetRoot: f.libraryRoot,
      dryRun: true,
    })
    expect(outcome).toMatchObject({
      status: "planned",
      title: "Planned",
      manifestPageCount: 7,
      dir: path.join(f.libraryRoot, "Planned"),
    })
    expect(foldersIn(f.libraryRoot)).toEqual([])
  })
})

/** Reads an entry out of a package the way the migrator does. */
async function readEntryBytes(packagePath: string, entryName: string): Promise<Buffer> {
  const outcome = await readViaArchive(packagePath, entryName)
  return outcome
}

async function readViaArchive(packagePath: string, entryName: string): Promise<Buffer> {
  const { ZipArchive } = await import("../../../src/main/migrate/zipReader")
  const archive = await ZipArchive.open(packagePath)
  try {
    return await archive.readEntry(entryName)
  } finally {
    await archive.close()
  }
}
