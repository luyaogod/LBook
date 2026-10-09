import { protocol } from "electron"
import path from "node:path"
import type { AppContext } from "../context"
import { readCover, readEntry, readManifest } from "../lbook/reader"

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
}

function mimeFor(entryName: string): string {
  return MIME_BY_EXTENSION[path.extname(entryName).toLowerCase()] ?? "application/octet-stream"
}

/**
 * Serves the contents of .lbook packages the DOM loads by URL:
 *
 *   lbook://cover/<uid>            the package cover
 *   lbook://asset/<uid>/<entry>    images referenced by OCR blocks
 *
 * The PDF deliberately does not go through here. pdf.js only issues range
 * requests against http(s) URLs, so book bytes travel over IPC instead — see
 * DESIGN.md for the pdf.js source that makes this necessary.
 */
export function registerLbookProtocol(context: AppContext): void {
  protocol.handle("lbook", async (request) => {
    try {
      const { host, pathname } = new URL(request.url)
      const segments = pathname.split("/").filter((segment) => segment !== "")
      const uid = decodeURIComponent(segments[0] ?? "")
      if (!uid) return notFound()

      const row = context.repos.documents.getByUid(uid)
      if (!row) return notFound()

      if (host === "cover") {
        const cover = await readCover(row.file_path, await readManifest(row.file_path))
        if (!cover) return notFound()
        return new Response(new Uint8Array(cover.data), {
          headers: { "Content-Type": cover.mime, "Cache-Control": "no-cache" },
        })
      }

      if (host === "asset") {
        const entryName = segments.slice(1).map(decodeURIComponent).join("/")
        if (entryName === "") return notFound()
        const data = await readEntry(row.file_path, entryName)
        return new Response(new Uint8Array(data), {
          headers: { "Content-Type": mimeFor(entryName) },
        })
      }

      return notFound()
    } catch {
      return notFound()
    }
  })
}

function notFound(): Response {
  return new Response("Not found", { status: 404 })
}
