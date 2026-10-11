import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Who is allowed to open a book's PDF.
 *
 * This is a source-level test because the bug it guards against is a *placement* one, and
 * nothing about the code looks wrong where it was placed: `usePdfDocumentProxy` was called
 * inside `PdfViewer` and `FlowViewer`, both of which live inside conditionals (the page area
 * disappears while the OCR panel is expanded; flip and continuous scroll are alternatives).
 * Unmounting a viewer therefore destroyed the pdf.js document — `loadingTask.destroy()` and
 * `pdfDoc.cleanup()` are in the hook's cleanup — so switching views fetched and parsed the
 * book again, which reads as the app "refreshing".
 *
 * One document per book, opened once, needs an owner that does not unmount: `App`. If
 * someone puts the hook back into a viewer, this fails with the reason attached, which is
 * cheaper than rediscovering it from a screenshot.
 */

const RENDERER = path.resolve("src/renderer")

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, found)
    else if (/\.tsx?$/.test(entry.name)) found.push(full)
  }
  return found
}

const relative = (file: string): string => path.relative(RENDERER, file).replace(/\\/g, "/")

describe("the PDF document's owner", () => {
  it("is App, and nothing else", () => {
    const callers = sourceFiles(RENDERER)
      .filter((file) => relative(file) !== "hooks/usePdfDocumentProxy.ts")
      .filter((file) => fs.readFileSync(file, "utf8").includes("usePdfDocumentProxy("))
      .map(relative)

    expect(callers).toEqual(["App.tsx"])
  })

  it("is passed to the viewers rather than re-opened by them", () => {
    // The other half of the same rule: the viewers must take the document as a prop, which
    // is only possible while they are not the ones loading it.
    for (const viewer of ["components/viewer/PdfViewer.tsx", "components/viewer/FlowViewer.tsx"]) {
      const source = fs.readFileSync(path.join(RENDERER, viewer), "utf8")
      expect(source, `${viewer} should take pdfDoc as a prop`).toMatch(/pdfDoc:\s*PDFDocumentProxy \| null/)
    }
  })
})
