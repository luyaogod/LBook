import { net, protocol, session } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * The shell the renderer runs in: the two custom schemes, the policy that governs what they
 * may load, and the handler that serves a built bundle.
 *
 * This lives in its own module because two things must agree on it exactly — the app (see
 * `index.ts`) and the headless probes that check features under the production protocol
 * (`scripts/check-editor.ts`). A probe carrying its own copy of the policy would keep
 * passing after the app's had changed.
 */

/**
 * Scheme privileges, which must be registered before `app.whenReady()`.
 *
 * `app://bundle/...` serves the built renderer. We cannot load it over `file://`: that
 * origin is opaque, so `new Worker(file://...)` is rejected and pdf.js silently falls back
 * to parsing PDFs on the main thread.
 *
 * `lbook://` serves book files the DOM loads by URL (`<img src>`).
 */
export function registerShellSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
    {
      scheme: "lbook",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * Production-only. `script-src` deliberately excludes 'unsafe-inline' and `img-src`
 * excludes remote hosts: OCR block content is rendered through rehype-raw and
 * dangerouslySetInnerHTML, so `<img src=x onerror=...>` is a live XSS path that the CSP
 * must close.
 *
 * Note what is not here: `'unsafe-eval'`. Neither pdf.js nor CodeMirror needs it, and
 * `npm run check:editor` fails if the editor starts asking for it.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: lbook:",
  // Speech comes back from the main process as bytes and is played from a Blob URL;
  // without this line `default-src 'none'` blocks it and the audio element only reports
  // the useless "no supported source was found".
  "media-src 'self' blob:",
  "connect-src 'self' lbook:",
  "worker-src 'self'",
].join("; ")

/** Attaches `PRODUCTION_CSP` to every response in this session. */
export function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [PRODUCTION_CSP],
      },
    })
  })
}

/** Serves `app://bundle/<path>` out of a built bundle directory. */
export function registerBundleProtocol(bundleDir: string): void {
  protocol.handle("app", async (request) => {
    const { host, pathname } = new URL(request.url)
    if (host !== "bundle") {
      return new Response("Not found", { status: 404 })
    }

    const relative = pathname === "/" ? "/index.html" : pathname
    const absolute = path.join(bundleDir, path.normalize(relative))

    // Guard against path traversal escaping the bundle directory.
    if (absolute !== bundleDir && !absolute.startsWith(bundleDir + path.sep)) {
      return new Response("Forbidden", { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(absolute).toString())
    } catch {
      return new Response("Not found", { status: 404 })
    }
  })
}
