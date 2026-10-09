import { promises as fsp } from "node:fs"
import type { BookManifest } from "../../shared/types"
import { ENTRY_MANIFEST, ENTRY_PDF, LBOOK_FORMAT_VERSION, parseManifest } from "./manifest"
import { COMPRESSION_DEFLATE, COMPRESSION_STORE, ZipArchive } from "./zipIndex"

export interface ValidationIssue {
  code: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  manifest: BookManifest | null
  /** True when book.pdf is deflated and the package must be normalized on import. */
  needsRepack: boolean
}

/**
 * Validates a .lbook package.
 *
 * The hard rule is that `book.pdf` must be STORED. A deflated PDF cannot be
 * seeked into: every byte-range read would have to inflate from offset zero,
 * making the viewer quadratic over the book.
 */
export async function validateLbook(filePath: string): Promise<ValidationResult> {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  let manifest: BookManifest | null = null
  let needsRepack = false

  try {
    const stats = await fsp.stat(filePath)
    if (!stats.isFile()) {
      return fail("not-a-file", "Path is not a regular file")
    }
    if (stats.size === 0) {
      return fail("empty", "File is empty")
    }
  } catch {
    return fail("missing", `File not found: ${filePath}`)
  }

  let archive: ZipArchive
  try {
    archive = await ZipArchive.open(filePath)
  } catch (error) {
    // The parser rejects hostile entry names while reading the central
    // directory, so such a package never opens at all. Report it as what it is
    // rather than as a generic corrupt-zip error.
    const message = describe(error)
    if (/invalid relative path|absolute path/i.test(message)) {
      return fail("unsafe-entry", `Package contains an unsafe entry name: ${message}`)
    }
    return fail("not-a-zip", `Not a readable ZIP archive: ${message}`)
  }

  try {
    for (const name of archive.unsafeEntryNames) {
      errors.push({ code: "unsafe-entry", message: `Unsafe entry name rejected: ${name}` })
    }

    for (const entry of archive.listEntries()) {
      if (entry.compressionMethod !== COMPRESSION_STORE && entry.compressionMethod !== COMPRESSION_DEFLATE) {
        errors.push({
          code: "unsupported-compression",
          message: `Entry "${entry.name}" uses unsupported compression method ${entry.compressionMethod}`,
        })
      }
    }

    const manifestEntry = archive.getEntry(ENTRY_MANIFEST)
    if (!manifestEntry) {
      errors.push({ code: "missing-manifest", message: `Package has no ${ENTRY_MANIFEST}` })
    } else {
      try {
        manifest = parseManifest(await archive.readText(ENTRY_MANIFEST))
        if (manifest.formatVersion > LBOOK_FORMAT_VERSION) {
          errors.push({
            code: "format-too-new",
            message: `Package format version ${manifest.formatVersion} is newer than this build supports (${LBOOK_FORMAT_VERSION})`,
          })
        }
      } catch (error) {
        errors.push({ code: "bad-manifest", message: `Cannot parse ${ENTRY_MANIFEST}: ${describe(error)}` })
      }
    }

    const pdfEntry = archive.getEntry(ENTRY_PDF)
    if (!pdfEntry) {
      errors.push({ code: "missing-pdf", message: `Package has no ${ENTRY_PDF}` })
    } else if (pdfEntry.compressionMethod !== COMPRESSION_STORE) {
      errors.push({
        code: "pdf-compressed",
        message:
          `${ENTRY_PDF} must be stored (method 0) but is method ${pdfEntry.compressionMethod}. ` +
          `Random access requires a stored entry.`,
      })
      needsRepack = true
    }

    if (manifest && pdfEntry) {
      if (manifest.pdfSize > 0 && manifest.pdfSize !== pdfEntry.uncompressedSize) {
        warnings.push({
          code: "size-mismatch",
          message: `manifest.pdfSize (${manifest.pdfSize}) does not match the stored size (${pdfEntry.uncompressedSize})`,
        })
      }
      if (manifest.hasOcr && !archive.has("ocr.json")) {
        warnings.push({
          code: "ocr-missing",
          message: "manifest claims OCR data but ocr.json is absent",
        })
      }
    }
  } finally {
    await archive.close()
  }

  return { ok: errors.length === 0, errors, warnings, manifest, needsRepack }

  function fail(code: string, message: string): ValidationResult {
    return { ok: false, errors: [{ code, message }], warnings, manifest: null, needsRepack: false }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
