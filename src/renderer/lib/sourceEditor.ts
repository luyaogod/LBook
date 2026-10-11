import type { EditorView } from "@codemirror/view"

/**
 * The source editor: CodeMirror 6, loaded on demand.
 *
 * **Why CodeMirror and not Monaco** — Obsidian's own developer documentation says
 * "Obsidian uses CodeMirror 6 (CM6) to power the Markdown editor", and this app follows
 * Obsidian's editing model deliberately (see A21/A22 in `.agents/plan/00-decisions.md`).
 * It is also the smaller answer to the same question: CM6 needs **no web worker** and no
 * `new Function`, so nothing here runs into the `app://`-worker or `'unsafe-eval'` walls
 * that made Monaco cost a shared module, a second build and an Electron probe to verify.
 *
 * What is imported is chosen, not `basicSetup`: line numbers, history, the syntax
 * highlighter, search and the selection helpers are what correcting OCR text wants.
 * Autocompletion, lint gutters and folding — most of what `basicSetup` adds — would be
 * noise on a 3–13KB field.
 *
 * The editor owns its own undo history while it is open (Mod-Z inside it belongs to it,
 * the same rule the textarea had). Saving is still ours: Mod-Enter writes, Esc closes, and
 * nothing here writes to disk.
 */
export interface SourceEditorHandle {
  /** The text as it stands in the editor. */
  value(): string
  focus(): void
  /** Whether the text differs from what it was opened with. */
  isDirty(): boolean
  destroy(): void
}

export interface SourceEditorOptions {
  /** Where to mount it. The caller keeps the surrounding chrome. */
  parent: HTMLElement
  value: string
  /** `markdown` for a page's text or a text block, `html` for a table block's source. */
  language: "markdown" | "html"
  /** Follows the app's theme. */
  dark: boolean
  /** Mod-Enter, and the Save button: the reader asked to write. */
  onSave: () => void
  /** Esc, and the Cancel button: close without touching the file. */
  onCancel: () => void
  /** Every change, so the caller's Save button can tell whether anything changed. */
  onValueChange: (value: string) => void
  /**
   * CodeMirror's own labels for the search panel, in the reader's language.
   *
   * Passed in rather than translated here, so this module keeps knowing nothing about the
   * interface: the caller has `t()`, and the check page (a separate build) does not need to
   * pull the whole i18n setup in to mount an editor.
   */
  phrases?: Record<string, string>
}

/** The one theme, small enough to keep here rather than pull a package for it. */
async function themeFor(dark: boolean) {
  const { EditorView } = await import("@codemirror/view")
  const reading = getComputedStyle(document.documentElement).getPropertyValue("--reading-font-size").trim()
  return EditorView.theme(
    {
      "&": {
        fontSize: reading === "" ? "14px" : reading,
        backgroundColor: "transparent",
        color: "inherit",
      },
      ".cm-content": {
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace",
        padding: "6px 0",
      },
      // The Markdown pane can be narrow: wrapping matters more than seeing column 120.
      ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.6" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: dark ? "#8b8b8b" : "#9ca3af",
        border: "none",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-activeLine": { backgroundColor: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" },
    },
    { dark },
  )
}

/** Builds an editor in `parent`. Resolves once it is mounted and focused. */
export async function createSourceEditor(options: SourceEditorOptions): Promise<SourceEditorHandle> {
  const [
    { EditorState },
    { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor },
    { defaultKeymap, history, historyKeymap, indentWithTab },
    { syntaxHighlighting, defaultHighlightStyle, indentOnInput },
    { search, searchKeymap, searchPanelOpen },
  ] = await Promise.all([
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/commands"),
    import("@codemirror/language"),
    import("@codemirror/search"),
  ])

  const language =
    options.language === "html"
      ? (await import("@codemirror/lang-html")).html()
      : (await import("@codemirror/lang-markdown")).markdown()

  const state = EditorState.create({
    doc: options.value,
    extensions: [
      // Ours first: a keymap listed earlier wins, so Esc closes the editor instead of
      // whatever the default keymap would do with it.
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            options.onSave()
            return true
          },
        },
        {
          key: "Escape",
          // **Yield when the search panel is open.** Our keymap is listed first, so without
          // this the reader pressing Esc to close Find would instead close the editor and
          // lose the search — and the default keymap never gets a chance. Returning false
          // hands the key on, which is what closes the panel.
          run: (view) => {
            if (searchPanelOpen(view.state)) return false
            options.onCancel()
            return true
          },
        },
      ]),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // Find (Mod-F) and go-to-line. The panel's labels are CodeMirror's own English
      // strings unless we replace them, which is what `phrases` is for.
      search({ top: true }),
      keymap.of(searchKeymap),
      EditorState.phrases.of(options.phrases ?? {}),
      EditorView.lineWrapping,
      await themeFor(options.dark),
      language,
      EditorView.updateListener.of((update) => {
        // No dirty state is kept here (A20): the caller compares against the text it loaded.
        if (update.docChanged) options.onValueChange(update.state.doc.toString())
      }),
      // Only one editor is ever open, so a bounded height with its own scrolling is
      // simpler than growing the panel — and it keeps the surrounding page still.
      EditorView.theme({ "&": { maxHeight: "60vh" } }),

    ],
  })

  const view = new EditorView({ state, parent: options.parent })
  view.focus()

  return {
    value: () => view.state.doc.toString(),
    focus: () => view.focus(),
    isDirty: () => view.state.doc.toString() !== options.value,
    destroy: () => view.destroy(),
  }
}

/** Only for the type import above; keeps `EditorView` referenced without a runtime import. */
export type { EditorView }
