import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { LBOOK_FORMAT_VERSION } from "../../../src/main/lbook/manifest"
import { validateLbook } from "../../../src/main/lbook/validate"
import { buildLbook, fakePdf, writeRawZip } from "../../helpers/lbook"

let dir: string | undefined

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lbook-validate-"))
  return dir
}

describe("validateLbook", () => {
  it("accepts a well-formed package", async () => {
    const { filePath } = await buildLbook({ dir: tempDir() })
    const result = await validateLbook(filePath)

    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.manifest?.format).toBe("lbook")
  })

  it("rejects a missing file", async () => {
    const result = await validateLbook(path.join(tempDir(), "nope.lbook"))
    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe("missing")
  })

  it("rejects an empty file", async () => {
    const filePath = path.join(tempDir(), "empty.lbook")
    fs.writeFileSync(filePath, "")
    const result = await validateLbook(filePath)
    expect(result.errors[0].code).toBe("empty")
  })

  it("rejects a file that is not a zip", async () => {
    const filePath = path.join(tempDir(), "text.lbook")
    fs.writeFileSync(filePath, "just some plain text, definitely not a zip archive")
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe("not-a-zip")
  })

  it("flags a deflated PDF as fatal and asks for a repack", async () => {
    // This is the one condition that would make the viewer quadratic.
    const { filePath } = await buildLbook({ dir: tempDir(), compressPdf: true })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.needsRepack).toBe(true)
    expect(result.errors.map((e) => e.code)).toContain("pdf-compressed")
  })

  it("reports a missing manifest", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), omitManifest: true })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain("missing-manifest")
  })

  it("reports an unparseable manifest", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), rawManifest: "{ not json" })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain("bad-manifest")
  })

  it("reports a manifest that is not an LBook manifest", async () => {
    const { filePath } = await buildLbook({
      dir: tempDir(),
      rawManifest: JSON.stringify({ format: "something-else", uid: "x", formatVersion: 1 }),
    })
    const result = await validateLbook(filePath)

    expect(result.errors.map((e) => e.code)).toContain("bad-manifest")
  })

  it("rejects a package from a newer format version", async () => {
    const { filePath } = await buildLbook({
      dir: tempDir(),
      manifestOverrides: { formatVersion: LBOOK_FORMAT_VERSION + 1 },
    })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain("format-too-new")
  })

  it("warns, but does not fail, when manifest.pdfSize disagrees", async () => {
    const { filePath } = await buildLbook({
      dir: tempDir(),
      manifestOverrides: { pdfSize: 999_999 },
    })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(true)
    expect(result.warnings.map((w) => w.code)).toContain("size-mismatch")
  })

  it("warns when the manifest claims OCR data that is not present", async () => {
    const { filePath } = await buildLbook({
      dir: tempDir(),
      ocr: null,
      manifestOverrides: { hasOcr: true },
    })
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(true)
    expect(result.warnings.map((w) => w.code)).toContain("ocr-missing")
  })

  it("reports a hostile traversal entry as unsafe rather than corrupt", async () => {
    const filePath = writeRawZip(path.join(tempDir(), "hostile.lbook"), [
      { name: "../../etc/passwd", data: Buffer.from("x") },
    ])
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors[0].code).toBe("unsafe-entry")
  })

  it("rejects a package with no book.pdf", async () => {
    const filePath = writeRawZip(path.join(tempDir(), "nopdf.lbook"), [
      {
        name: "manifest.json",
        data: Buffer.from(
          JSON.stringify({ format: "lbook", uid: "u", formatVersion: 1, title: "t" }),
        ),
      },
    ])
    const result = await validateLbook(filePath)

    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain("missing-pdf")
  })

  it("rejects a truncated package", async () => {
    const { filePath } = await buildLbook({ dir: tempDir(), pdf: fakePdf(10_000) })
    const truncated = path.join(tempDir(), "truncated.lbook")
    fs.writeFileSync(truncated, fs.readFileSync(filePath).subarray(0, 200))

    const result = await validateLbook(truncated)
    expect(result.ok).toBe(false)
  })
})
