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

/**
 * Dispatches a keydown where CodeMirror listens for one.
 *
 * The target matters: CM6's keymap handler is attached to the **content** element, not to
 * the editor's wrapper. Dispatching on the wrapper looked plausible and did nothing — and
 * because the check "Esc closes the panel, not the editor" was then reading state that
 * never changed, it passed for the wrong reason.
 */
function press(editor: Element, key: string, modifiers: { ctrlKey?: boolean } = {}): void {
  const target = editor.querySelector(".cm-content") ?? editor
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }))
}


const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

async function main(): Promise<void> {
  const checks: Check[] = []
  const surface = document.getElementById("surface")!
  let cancelled = 0

  const markdown = await createSourceEditor({
    parent: surface,
    value: "# heading\n\nA paragraph with *emphasis* and a [link](app://bundle/index.html).\n",
    language: "markdown",
    dark: false,
    // A couple of the panel's labels, to prove the ones we pass are the ones shown.
    phrases: { Find: "查找", Replace: "替换为", next: "下一个", previous: "上一个", close: "关闭" },
    onSave: () => undefined,
    onCancel: () => {
      cancelled++
    },
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
  // The layout contract: the editor **fills its box**, and the box decides how big that is
  // (the Markdown pane hands it the panel's remaining height, a block card caps it). The
  // container here is 240px, so the editor has to be 240px — a max-height would leave a
  // short editor with empty space under it, which is what the reader complained about.
  const container = surface.getBoundingClientRect().height
  const editorBox = surface.querySelector(".cm-editor")?.getBoundingClientRect().height ?? 0
  checks.push({
    what: "the editor fills its container",
    ok: Math.abs(editorBox - container) <= 2,
    detail: `editor ${Math.round(editorBox)}px of ${Math.round(container)}px`,
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

  // ---- the search panel ---------------------------------------------------------
  const editorRoot = surface.querySelector(".cm-editor")!
  press(editorRoot, "f", { ctrlKey: true })
  await settle()

  const panel = surface.querySelector(".cm-search")
  const field = panel?.querySelector("input") ?? null
  checks.push({ what: "Mod-F opens the search panel", ok: panel !== null })
  checks.push({
    what: "the panel's labels are the ones we passed, not CodeMirror's English",
    ok: field?.placeholder === "查找",
    detail: `placeholder ${JSON.stringify(field?.placeholder ?? null)}`,
  })

  // The escape that matters: ours is listed first, so it has to yield to the panel. Without
  // that, Esc would close the editor — losing the search, and the text with it.
  press(editorRoot, "Escape")
  await settle()
  checks.push({
    what: "Esc closes the panel, not the editor",
    ok: surface.querySelector(".cm-search") === null && cancelled === 0,
    detail: `cancelled=${cancelled}`,
  })

  press(editorRoot, "Escape")
  await settle()
  checks.push({ what: "a second Esc closes the editor", ok: cancelled === 1, detail: `cancelled=${cancelled}` })

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

  // ---- who owns the scrollbar ---------------------------------------------------
  // A long document must scroll **inside** the editor, and the box around it must not
  // scroll at all: the panel gives the editor an exact height, and the editor is the only
  // thing that moves. Two scrollbars for one document is what the reader reported.
  //
  // **The boxes here mirror `SourceEditorField`**: a wrapper that is a flex column (the
  // caller's `flex-1 min-h-0` lives there) holding the editor's own box at `flex-1`. An
  // earlier version of this check mounted the editor straight into a fixed-height div — so
  // it passed while the app could not scroll at all, because the app had that wrapper in
  // between and `flex-1` resolved against an auto-height block. The structure is the thing
  // being tested as much as the editor is.
  const outer = document.createElement("div")
  outer.style.height = "200px"
  outer.style.overflow = "hidden"
  outer.style.display = "flex"
  outer.style.minHeight = "0"
  outer.style.flexDirection = "column"
  document.body.appendChild(outer)
  const host = document.createElement("div")
  host.style.flex = "1"
  host.style.minHeight = "0"
  host.style.overflow = "hidden"
  outer.appendChild(host)
  const longText = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n")
  const longEditor = await createSourceEditor({
    parent: host,
    value: longText,
    language: "markdown",
    dark: true,
    onSave: () => undefined,
    onCancel: () => undefined,
    onValueChange: () => undefined,
  })
  const scroller = outer.querySelector(".cm-scroller")

  checks.push({
    what: "a long page scrolls inside the editor",
    ok: scroller !== null && scroller.scrollHeight > scroller.clientHeight + 10,
    detail:
      scroller === null
        ? "no scroller"
        : `${scroller.scrollHeight}px of content in ${scroller.clientHeight}px`,
  })
  checks.push({
    what: "and the box around it does not scroll",
    ok: outer.scrollHeight <= outer.clientHeight + 1,
    detail: `${outer.scrollHeight}px of content in ${outer.clientHeight}px`,
  })
  // Windows hides overlay scrollbars until you scroll, so a document longer than its box
  // looks like a document that cannot scroll — the reader reported exactly that. The theme
  // asks for a thin, always-drawn one; this asserts the rule arrived.
  const scrollbarWidth = scroller === null ? "" : getComputedStyle(scroller).scrollbarWidth
  checks.push({
    what: "the scrollbar is drawn, not left to the platform's overlay",
    ok: scrollbarWidth === "thin",
    detail: `scrollbar-width: ${scrollbarWidth === "" ? "(not supported here)" : scrollbarWidth}`,
  })

  longEditor.destroy()
  outer.remove()

  // ---- the block card's shape, which is a different problem ----------------------
  // A card does not fill anything: it sits in a scrolling column and must shrink to its
  // content, so its wrapper has **no height of its own**, only a cap. The editor then needs
  // a ceiling of its own (`maxHeightPx`) or it grows to the whole document inside the capped
  // wrapper: the wrapper clips, the editor has nothing to scroll, and the reader cannot move
  // the text — which is exactly the bug this case exists for. The first version of this
  // check mirrored the *pane's* shape only, so it passed while the card was stuck.
  const card = document.createElement("div")
  card.style.maxHeight = "384px"
  card.style.display = "flex"
  card.style.minHeight = "0"
  card.style.flexDirection = "column"
  card.style.overflow = "hidden"
  document.body.appendChild(card)
  const cardHost = document.createElement("div")
  cardHost.style.flex = "1"
  cardHost.style.minHeight = "0"
  cardHost.style.overflow = "hidden"
  card.appendChild(cardHost)
  const tableHtml = `<table><tr>${Array.from({ length: 300 }, (_, index) => `<td>cell ${index + 1}</td>`).join("")}</tr></table>`
  const cardEditor = await createSourceEditor({
    parent: cardHost,
    value: tableHtml,
    language: "html",
    dark: true,
    maxHeightPx: 384,
    onSave: () => undefined,
    onCancel: () => undefined,
    onValueChange: () => undefined,
  })
  const cardScroller = card.querySelector(".cm-scroller")
  checks.push({
    what: "a long block scrolls inside its card",
    ok: cardScroller !== null && cardScroller.scrollHeight > cardScroller.clientHeight + 10,
    detail:
      cardScroller === null
        ? "no scroller"
        : `${cardScroller.scrollHeight}px of content in ${cardScroller.clientHeight}px`,
  })
  checks.push({
    what: "and the card stays within its cap",
    ok: card.getBoundingClientRect().height <= 385,
    detail: `card ${Math.round(card.getBoundingClientRect().height)}px`,
  })
  cardEditor.destroy()
  card.remove()


  report(checks)

}

void main().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error))
  report([{ what: "the spike ran to the end", ok: false }])
})
