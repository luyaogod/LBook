import { promises as fsp } from "node:fs"
import { validateLbook } from "../src/main/lbook/validate"
import { pdfDataStart, pdfSize, readManifest, readPdfRange } from "../src/main/lbook/reader"
import { closeAllArchives } from "../src/main/lbook/archiveCache"

async function main() {
  const pkg = process.argv[2]
  const original = process.argv[3]

  const v = await validateLbook(pkg)
  console.log("validate:", v.ok ? "OK" : "FAILED", v.errors.map(e => e.code).join(",") || "-", "warnings:", v.warnings.map(w => w.code).join(",") || "-")

  const manifest = await readManifest(pkg)
  const size = await pdfSize(pkg)
  const start = await pdfDataStart(pkg)
  console.log(`manifest: ${manifest.title} uid=${manifest.uid.slice(0,8)} pages=${manifest.pageCount}`)
  console.log(`pdfSize=${size} dataStart=${start} hasOcr=${manifest.hasOcr}`)

  const head = await readPdfRange(pkg, 0, 7)
  console.log("magic:", JSON.stringify(head.toString("latin1")))

  const src = await fsp.readFile(original)
  console.log("original size:", src.length, "match:", src.length === size)

  let allEqual = true
  for (const [b, e] of [[0, 65535], [1000000, 1065535], [size - 4096, size - 1]]) {
    const got = await readPdfRange(pkg, b, e)
    const want = src.subarray(b, e + 1)
    const ok = got.equals(want)
    if (!ok) allEqual = false
    console.log(`range ${b}..${e}: ${got.length}B equal=${ok}`)
  }
  console.log(allEqual ? "ALL BYTE RANGES MATCH" : "MISMATCH FOUND")
  closeAllArchives()
}
void main().catch(e => { console.error(e); process.exit(1) })
