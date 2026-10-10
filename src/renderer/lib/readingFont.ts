/**
 * The one place that knows how the reading font size reaches CSS.
 *
 * It is a custom property on `<html>` rather than a prop or an inline style on
 * the panels: `.markdown-body` is where the size is used, and that class is
 * global (index.css), so a prop would have to be threaded through `OcrSidebar`
 * and `BlockCard` to say the same thing twice.
 *
 * There are two writers and they always agree, because both write the same
 * stored number: `App` applies it whenever a settings payload arrives, and the
 * settings slider applies it while dragging so that the pane follows the pointer
 * instead of jumping when the mouse comes up.
 */
export function applyReadingFontSize(px: number): void {
  document.documentElement.style.setProperty("--reading-font-size", `${px}px`);
}
