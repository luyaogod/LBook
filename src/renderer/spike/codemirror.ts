/**
 * A check, not a screen: does the source editor work under `app://` with the production CSP?
 *
 * `npm run check:editor` (`scripts/check-editor.ts`) loads this in a hidden Electron window
 * served by the same protocol handler and the same policy the app uses, then reads
 * `window.__editorSpike` back out. It exists because the risky part of embedding an editor
 * here is not the editor — it is the origin and the policy: a blocked `style-src` or a
 * chunk that will not load leaves an empty box, and an editor that "looks fine in dev"
 * proves nothing about the packaged app.
 *
 * CodeMirror needs no worker and no `new Function`, so the checks are about the two things
 * it does need: its styles, and its dynamically imported language support.
 */
import { createSourceEditor } from "../lib/sourceEditor"

interface Check {
  what: string
  ok: boolean
  detail?: string
}

interface SpikeResult {
  ok: boolean
  ms: number
  checks: Check[]
  errors: string[]
  cspViolations: string[]
}

declare global {
  interface Window {
    __editorSpike?: SpikeResult
  }
}

const errors: string[] = []
const cspViolations: string[] = []

// Captured before the editor loads, so a boot failure is reported by the page that caused it.
const originalError = console.error
console.error = (...args: unknown[]) => {
  errors.push(args.map((value) => (value instanceof Error ? value.message : String(value))).join(" "))
  originalError(...args)
}

document.addEventListener("securitypolicyviolation", (event) => {
  cspViolations.push(`${event.violatedDirective} ← ${event.blockedURI}`)
})

const started = Date.now()

function report(checks: Check[]): void {
  const result: SpikeResult = {
    ok: checks.every((check) => check.ok) && cspViolations.length === 0 && errors.length === 0,
    ms: Date.now() - started,
    checks,
    errors,
    cspViolations,
  }
  window.__editorSpike = result
  console.log(`[editor-spike] ${result.ok ? "ok" : "FAILED"} in ${result.ms}ms`)
}

async function main(): Promise<void> {
  const checks: Check[] = []
  const surface = document.getElementById("surface")!

  const markdown = await createSourceEditor({
    parent: surface,
    value: "# heading\n\nA paragraph with *emphasis* and a [link](app://bundle/index.html).\n",
    language: "markdown",
    dark: false,
    onSave: () => undefined,
    onCancel: () => undefined,
    onValueChange: () => undefined,
  })

  checks.push({
    what: "an editor mounts into the DOM",
    ok: surface.querySelector(".cm-editor") !== null,
  })
  checks.push({
    what: "its styles were applied (no blocked stylesheet)",
    ok: surface.querySelector(".cm-content") !== null,
    detail: `${surface.querySelectorAll(".cm-line").length} line(s)`,
  })
  checks.push({
    what: "line numbers rendered",
    ok: surface.querySelector(".cm-gutters") !== null,
  })
  // The Markdown language support is a separate lazy chunk; highlighted spans only appear
  // once it has arrived.
  await new Promise((resolve) => setTimeout(resolve, 300))
  checks.push({
    what: "the markdown language arrives through a lazy chunk",
    ok: surface.querySelectorAll(".cm-content span[class*='ͼ'], .cm-content span[class*='cm-']").length > 2,
    detail: `${surface.querySelectorAll(".cm-content span").length} span(s)`,
  })
  checks.push({
    what: "typing is reflected in the value",
    ok: markdown.value().startsWith("# heading"),
  })

  // Read-only territory: the editor must not have touched what it was given.
  markdown.destroy()

  const html = await createSourceEditor({
    parent: surface,
    value: "<table><tr><td>1</td></tr></table>\n",
    language: "html",
    dark: true,
    onSave: () => undefined,
    onCancel: () => undefined,
    onValueChange: () => undefined,
  })
  checks.push({
    what: "the html language loads too (a table block's source)",

    ok: surface.querySelector(".cm-editor") !== null && html.value().startsWith("<table>"),
  })
  html.destroy()

  report(checks)
}

void main().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error))
  report([{ what: "the spike ran to the end", ok: false }])
})
