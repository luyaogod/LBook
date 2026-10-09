import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

/**
 * The window's minimize / maximize / close buttons, drawn by the app.
 *
 * Windows' own controls (`titleBarOverlay`) come as a package deal with a strip
 * painted in the system's colour and a close button that hovers red while its
 * neighbours hover grey. Drawing them here keeps all three on the header's own
 * background — and removes the seam between that strip and the header's bottom
 * border, since there is no strip any more.
 *
 * Two deliberate details:
 *
 * - They are **full height** and butted against each other and against the window
 *   edge, the way a title bar's controls sit. A centered 32px chip leaves the
 *   hover highlight floating in the middle of the header, which reads as a button
 *   in a toolbar rather than a window control.
 * - Close hovers **red**. That is the one thing worth keeping from the native
 *   controls: it is the convention every Windows user reads as "this closes the
 *   window". It is `#e81123` in both themes (Windows' own value) rather than
 *   `--destructive`, so it stays the same red on a dark background, where the
 *   dark palette's destructive tone is a washed-out pink.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  // Double-clicking the drag region, Win+Up or dragging to a screen edge all
  // change the state without going through these buttons.
  useEffect(() => window.api.window.onMaximizeChanged(setMaximized), []);

  const buttonClass =
    "no-drag flex h-full w-12 items-center justify-center text-muted-foreground transition-colors";

  return (
    <div className="ml-2 flex items-stretch self-stretch">
      <button
        className={`${buttonClass} hover:bg-accent hover:text-foreground`}
        onClick={() => void window.api.window.minimize()}
        title="Minimize"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        className={`${buttonClass} hover:bg-accent hover:text-foreground`}
        onClick={() => void window.api.window.toggleMaximize()}
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        className={`${buttonClass} hover:bg-[#e81123] hover:text-white`}
        onClick={() => void window.api.window.close()}
        title="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
