import type React from "react";

/**
 * How far the hit area reaches into each neighbour, in pixels.
 *
 * 3 + 3 = the 6px of grab width the pane edges had when the divider was a real
 * column, so the target did not shrink — it just stopped being painted.
 */
const HIT_HALF = 3;

interface PaneSashProps {
  onMouseDown: (e: React.MouseEvent) => void;
  /** True while this sash is the one being dragged. */
  dragging: boolean;
}

/**
 * The draggable divider between two panes, VS Code style.
 *
 * It occupies **no layout width**, and that is the whole point. A reserved 6px
 * column has to be painted *something*, and no colour works: the sash stands
 * between a panel (`--card`, white in light mode) and the desk around the page
 * (`#f8fafc`), so it shows as a band against whichever of the two it does not
 * copy. Painted the desk colour — which is what the previous version did, so
 * that handle and desk would read as one region — it was a grey strip wedged
 * between two white panels in light mode, i.e. a gap where there is no gap.
 *
 * So the panes touch and the divider is an overlay straddling the boundary
 * instead: invisible until the pointer is on it or a drag is in progress, and
 * only then does it paint a band. Nothing moves a pixel of layout, and the
 * toolbar's bottom border now reaches both panels on its own (that used to need
 * a `h-12 border-b` patch inside this gap).
 *
 * The hit area reaches only `HIT_HALF` into each neighbour so it stays clear of
 * the panel's own scrollbar: that bar is ~15px wide, and its inner 12px is still
 * grabbable — the outer 3px would start a pane drag instead.
 */
export function PaneSash({ onMouseDown, dragging }: PaneSashProps) {
  return (
    <div className="relative w-0 shrink-0">
      {/* `z-10`: the hit area has to sit above *both* neighbours — the panel
          before it in the row and the pane after it, which would otherwise
          swallow the clicks. */}
      <div
        onMouseDown={onMouseDown}
        className="group absolute inset-y-0 z-10 cursor-col-resize"
        style={{ left: -HIT_HALF, right: -HIT_HALF }}
      >
        {/* One solid band, hover and drag alike.

            It went through two worse shapes: a tinted 6px strip with a 2px solid
            line drawn on top of it (a translucent highlight takes the colour of
            whatever it lies on, so the same token read as two different colours
            across the two panes), and then a `bg-[#0090f1]/30` band. Solid is
            both simpler and more honest about what the layer *is* — and since it
            is solid, the separate 2px line had nothing left to add, so hover and
            drag now look the same. That is also what VS Code's sash does: the
            same bar whether you are pointing at it or already dragging. */}
        <div
          className={`pointer-events-none absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 bg-[#0090f1] transition-opacity group-hover:opacity-100 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    </div>
  );
}
