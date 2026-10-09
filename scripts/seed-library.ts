/**
 * Dev helper: packs a PDF plus its PaddleOCR output into a .lbook and drops it
 * into the library folder, so the app has something real to open.
 *
 *   npm run seed:library -- <file.pdf> <file.json> ["Title"]
 *
 * With no arguments it uses the Oxford Picture Dictionary pair in dev-data/.
 */
import { randomUUID } from "node:crypto"
import { promises as fsp } from "node:fs"
import os from "node:os"
import path from "node:path"
import { packageFileName } from "../src/main/lbook/manifest"
import { parseOcrPayload } from "../src/main/lbook/ocr"
import { packLbook } from "../src/main/lbook/packer"

const DEFAULTS = {
  pdf: "dev-data/Oxford Picture Dictionary 3 ed.pdf",
  ocr: "dev-data/Oxford Picture Dictionary 3 ed.ocr.json",
  title: "Oxford Picture Dictionary 3 ed",
}

async function main(): Promise<void> {
  const [pdfArg, ocrArg, titleArg] = process.argv.slice(2)

  const pdfPath = path.resolve(pdfArg ?? DEFAULTS.pdf)
  const ocrPath = path.resolve(ocrArg ?? DEFAULTS.ocr)
  const title = titleArg ?? DEFAULTS.title

  const libraryDir =
    process.env.LBOOK_LIBRARY_DIR ?? path.join(os.homedir(), "Documents", "LBook Library")

  await fsp.mkdir(libraryDir, { recursive: true })

  const uid = randomUUID().replace(/-/g, "")
  const outputPath = path.join(libraryDir, packageFileName(title, uid))

  console.log(`packing  ${path.basename(pdfPath)}`)
  console.log(`     +   ${path.basename(ocrPath)}`)
  console.log(`     ->  ${outputPath}`)

  const ocrJson = await fsp.readFile(ocrPath, "utf8")
  const pageCount = parseOcrPayload(JSON.parse(ocrJson)).pages.length

  const started = Date.now()
  const result = await packLbook({
    pdfPath,
    ocrJson,
    coverPath: null,
    uid,
    title,
    author: null,
    createdAt: new Date().toISOString(),
    pageCount,
    outputPath,
  })
  console.log(`pages    ${pageCount}`)

  const stats = await fsp.stat(outputPath)
  console.log(
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s  ` +
      `pdf=${(result.pdfSize / 1024 / 1024).toFixed(1)}MB  ` +
      `package=${(stats.size / 1024 / 1024).toFixed(1)}MB  uid=${uid}`,
  )
}

// Not a top-level await: this script is bundled to CJS so it can resolve the
// same native externals the main process uses.
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
