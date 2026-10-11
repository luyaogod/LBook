import { protocol } from "electron"
import { promises as fsp } from "node:fs"
import fs from "node:fs"
import path from "node:path"
import { LBOOK_DIR } from "../../shared/bookFile"
import type { AppContext } from "../context"
import { coverPath } from "../library/book"

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
}

function mimeFor(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? "application/octet-stream"
}

/**
 * Serves the files a book folder holds that the DOM loads by URL:
 *
 *   lbook://cover/<uid>            the book's cover file
 *   lbook://asset/<uid>/<name>     an image an OCR block points at
 *
 * Both resolve **inside that book's `.lbook` directory**, and a name that escapes it
 * is refused: the uid says which book, and the name says what to read out of its
 * metadata folder.
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

      const doc = await context.library.get(uid)
      if (!doc) return notFound()

      if (host === "cover") {
        const file = coverPath(doc.dir)
        if (!file) return notFound()
        return new Response(new Uint8Array(await fsp.readFile(file)), {
          headers: { "Content-Type": mimeFor(file), "Cache-Control": "no-cache" },
        })
      }

      if (host === "asset") {
        const name = segments.slice(1).map(decodeURIComponent).join("/")
        if (name === "") return notFound()

        const root = path.resolve(doc.dir, LBOOK_DIR)
        const file = path.resolve(root, name)
        // A relative reference inside an OCR block is data, not a path the user
        // chose; anything that climbs out of the metadata folder is refused.
        if (file !== root && !file.startsWith(root + path.sep)) return notFound()
        if (!fs.existsSync(file)) return notFound()

        return new Response(new Uint8Array(await fsp.readFile(file)), {
          headers: { "Content-Type": mimeFor(file) },
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
