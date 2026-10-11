import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SourceEditorHandle } from "@/lib/sourceEditor";

/**
 * A CodeMirror 6 editor as a React field.
 *
 * Two editors in this app show **source** — a page's Markdown and a block's text or HTML —
 * and both used to be a `<textarea>`. This wrapper exists so they share one mount/unmount
 * path and one set of keys: the editor is created when the field appears, destroyed when it
 * goes, and the text lives in the editor while the parent keeps a copy for its Save button.
 *
 * It reports every keystroke upward rather than holding a "dirty" flag of its own, because
 * the parent already compares against the value it loaded (A20: no dirty state, every save
 * writes).
 */
interface SourceEditorFieldProps {
  /**
   * Sizing for the field's box, from whoever is placing it.
   *
   * The editor fills its box (see `sourceEditor.ts`), so the box decides: the Markdown pane
   * hands it `flex-1` to fill the panel, a block card caps it so one card cannot swallow the
   * whole column.
   */
  className?: string;
  /** The text to open with. Read once, on mount: later changes are the editor's business. */
  value: string;
  /** `html` for a table block's source, `markdown` for everything else. */
  language: "markdown" | "html";
  /** Every change, so the parent's Save button knows whether anything changed. */
  onValueChange: (value: string) => void;
  /** Mod-Enter. */
  onSave: () => void;
  /** Esc. */
  onCancel: () => void;
}

export function SourceEditorField({
  className = "",
  value,
  language,
  onValueChange,
  onSave,
  onCancel,
}: SourceEditorFieldProps) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The search panel's labels, in the reader's language.
   *
   * The keys are CodeMirror's own (`phrase(view, "Find")` and friends) — read out of the
   * package, not guessed — and the values are ours. Without this the panel would be English
   * chrome in a Chinese interface.
   */
  const phrases: Record<string, string> = {
    Find: t("editor.find"),
    Replace: t("editor.replace"),
    replace: t("editor.replaceOne"),
    "replace all": t("editor.replaceAll"),
    next: t("editor.nextMatch"),
    previous: t("editor.previousMatch"),
    all: t("editor.allMatches"),
    "match case": t("editor.matchCase"),
    regexp: t("editor.regexp"),
    "by word": t("editor.byWord"),
    close: t("editor.close"),
    "Go to line": t("editor.goToLine"),
    go: t("editor.go"),
    "current match": t("editor.currentMatch"),
    "on line": t("editor.onLine"),
  };

  // The callbacks change identity on every render (they close over state); the editor is
  // created once, so it talks to them through a ref rather than being rebuilt.
  const handlers = useRef({ onValueChange, onSave, onCancel });
  handlers.current = { onValueChange, onSave, onCancel };

  useEffect(() => {
    let handle: SourceEditorHandle | null = null;
    let cancelled = false;

    void import("@/lib/sourceEditor")
      .then(({ createSourceEditor }) =>
        createSourceEditor({
          parent: host.current!,
          value,
          language,
          dark: document.documentElement.classList.contains("dark"),
          phrases,
          onSave: () => handlers.current.onSave(),
          onCancel: () => handlers.current.onCancel(),
          onValueChange: (next) => handlers.current.onValueChange(next),

        }),
      )
      .then((created) => {
        // The effect can be torn down before the dynamic import resolves (a fast Esc).
        if (cancelled) {
          created.destroy();
          return;
        }
        handle = created;
        handlers.current.onValueChange(created.value());
      })
      .catch((cause: unknown) => {
        // A field that cannot open is worth saying out loud: the reader would otherwise be
        // looking at an empty box with no way to tell whether their text is still there.
        setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      handle?.destroy();
      handle = null;
    };
    // Mount once per field: `value` is what the editor was opened on, not a controlled prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return (
    // **The caller's `className` goes on this wrapper, not on the editor's box.** The pane
    // says `flex-1 min-h-0` and the card says `max-h-96`, and both are about *this* level:
    // on the inner box, `flex-1` resolved against a plain block whose height came from its
    // content, so the editor grew to the height of the whole document, got clipped by the
    // panel's `overflow-hidden`, and **neither box could scroll**. Two scrollbars was the
    // complaint before; none at all was the bug after.
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div
        ref={host}
        // No border: the box is the panel. A block card draws its own outline around the
        // whole card and asks for one; the Markdown pane wants the text, edge to edge.
        className="min-h-0 flex-1 overflow-hidden bg-background"
        style={{ fontSize: "var(--reading-font-size, 14px)" }}
      />
      {error !== null && <p className="mt-1 shrink-0 text-xs text-destructive">{error}</p>}
    </div>
  );

}
