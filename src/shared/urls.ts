/**
 * URL builders for the `lbook://` custom protocol.
 *
 * Only entries the DOM loads by URL go through this scheme (`<img src>`, etc.).
 * The PDF deliberately does not: pdf.js only range-requests http(s) URLs, so
 * book bytes travel over IPC instead. See DESIGN.md.
 */

export const LBOOK_ENTRY_PDF = "book.pdf"
export const LBOOK_ENTRY_OCR = "ocr.json"
export const LBOOK_ENTRY_MANIFEST = "manifest.json"

export function coverUrl(uid: string): string {
  return `lbook://cover/${uid}`
}

export function assetUrl(uid: string, entryPath: string): string {
  const clean = entryPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")
  return `lbook://asset/${uid}/${clean}`
}

/**
 * Rewrites relative image references inside OCR content to lbook:// URLs.
 *
 * PaddleOCR emits `<img src="imgs/xxx.jpg">` and markdown_image keys of the same
 * shape. Left untouched they resolve against the app origin and 404.
 * Absolute URLs (http/https/data) are left alone so the CSP can keep blocking them.
 */
export function resolveAssetUrls(content: string, uid: string): string {
  return content.replace(
    /(?<=<img\b[^>]*\bsrc=["'])([^"']+)(?=["'])/gi,
    (src) => (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src) ? src : assetUrl(uid, src)),
  )
}
