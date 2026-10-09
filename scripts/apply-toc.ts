/**
 * Writes (or removes) a book's table of contents directly in its `.lbook`.
 *
 *   node scripts/run.mjs apply-toc <book.lbook> <toc.json>
 *   node scripts/run.mjs apply-toc <book.lbook> --clear
 *
 * The app does the same thing through the `book:replaceToc` channel; this
 * exists so a library can be primed in bulk without opening the app. The
 * package is rewritten in place — `book.pdf` is copied byte for byte, and the
 * OCR payload and cover are carried over untouched.
 *
 * The app reindexes a package whose container mtime moved, so no database
 * surgery is needed here: opening the book re-reads it.
 */
import { promises as fsp } from "node:fs"
import { parseToc } from "../src/shared/toc"
import { repackLbook } from "../src/main/lbook/packer"
import {
  closeBook,
  pdfDataStart,
  readCover,
  readManifest,
  readOcrText,
  readTocText,
} from "../src/main/lbook/reader"

async function main(): Promise<void> {
  const [packagePath, tocPath] = process.argv.slice(2)
  const clear = tocPath === "--clear"

  if (!packagePath || (!tocPath && !clear)) {
    console.error("usage: node scripts/run.mjs apply-toc <book.lbook> <toc.json>|--clear")
    process.exit(1)
  }

  let tocJson: string | null = null
  if (!clear) {
    const text = await fsp.readFile(tocPath, "utf8")
    // Validate first: a bad file must leave the package exactly as it was.
    const parsed = parseToc(JSON.parse(text))
    tocJson = text
    console.log(`${tocPath}: ${parsed.nodes.length} top-level entries, version ${parsed.version}`)
  }

  const manifest = await readManifest(packagePath)
  const dataStart = await pdfDataStart(packagePath)
  const ocrJson = await readOcrText(packagePath)
  const cover = await readCover(packagePath, manifest)

  // Windows refuses to rename over a file that still has an open handle.
  await closeBook(packagePath)

  await repackLbook({
    packagePath,
    outputPath: packagePath,
    pdfSize: manifest.pdfSize,
    pdfDataStart: dataStart,
    manifestFields: {
      uid: manifest.uid,
      title: manifest.title,
      author: manifest.author,
      createdAt: manifest.createdAt,
      pageCount: manifest.pageCount,
      pdfSha256: manifest.pdfSha256,
      cover: manifest.cover,
    },
    ocrJson,
    tocJson,
    coverBytes:
      cover && manifest.cover
        ? { name: manifest.cover.name, mime: manifest.cover.mime, data: cover.data }
        : null,
  })

  const after = await readManifest(packagePath)
  const storedToc = await readTocText(packagePath)
  console.log(`${after.title}: toc ${clear ? "removed" : "written"} (now ${storedToc ? "present" : "absent"})`)
  console.log(`ocr ${ocrJson ? "kept" : "absent"}, cover ${manifest.cover ? "kept" : "absent"}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
