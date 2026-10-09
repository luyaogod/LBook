import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ListTree, Loader2 } from "lucide-react";
import { findActiveTocId, tocAncestorIds, type FlatTocNode } from "@shared/toc";

interface TocPanelProps {
  /** Flattened entries, in reading order. */
  nodes: FlatTocNode[];
  loading: boolean;
  error: string | null;
  /** Page the viewer is showing, used to mark the entry being read. */
  currentPage: number;
  width: number;
  onJump: (page: number) => void;
}

/** Ids of every entry that has children, derived from the dotted ids. */
function parentIdsOf(nodes: FlatTocNode[]): Set<string> {
  const parents = new Set<string>();
  for (const node of nodes) {
    const cut = node.id.lastIndexOf(".");
    if (cut > 0) parents.add(node.id.slice(0, cut));
  }
  return parents;
}

/**
 * The deepest entry that is actually on screen for `id`.
 *
 * Expansion is stored as a set of collapsed subtrees, so an entry counts as
 * visible when none of its ancestors is collapsed. When the entry being read is
 * inside a subtree the reader closed, the nearest visible ancestor is
 * highlighted instead of forcing the subtree back open.
 *
 * `id` is a dotted position ("2.1"), so the only ancestors of a candidate are
 * its own prefixes and the check is a walk over those.
 */
function visibleEntryId(id: string, collapsed: Set<string>): string {
  const parts = id.split(".");
  let visible = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (collapsed.has(parts.slice(0, i).join("."))) break;
    visible = parts.slice(0, i + 1).join(".");
  }
  return visible;
}

/**
 * Left-hand table of contents.
 *
 * The tree is drawn from a flattened list rather than nested components: the
 * ids are positions ("2.1"), which makes expansion state a plain Set and lets
 * the active entry be found with one pass over the list.
 *
 * Deliberately has no controls of its own — an outline is added, replaced and
 * removed from the book's upload/edit dialog, so this is purely a reading aid.
 */
export function TocPanel({ nodes, loading, error, currentPage, width, onJump }: TocPanelProps) {
  const parents = useMemo(() => parentIdsOf(nodes), [nodes]);
  // Everything starts expanded, which is what makes a book's sections visible
  // without a click. Remounting on a book change (`key` in App.tsx) is what
  // resets this — no effect has to police it.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const activeId = useMemo(() => findActiveTocId(nodes, currentPage), [nodes, currentPage]);
  const markedId = activeId === null ? null : visibleEntryId(activeId, collapsed);

  const toggle = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // An entry is on screen only when every one of its ancestors is open.
  const visible = useMemo(
    () => nodes.filter((node) => !tocAncestorIds(node.id).some((id) => collapsed.has(id))),
    [nodes, collapsed],
  );

  // Keep the entry being read in view as the reader turns pages. The row has to
  // be committed before it can be scrolled to, hence an effect rather than a
  // render-time lookup.
  useEffect(() => {
    if (markedId === null) return;
    listRef.current?.querySelector(`[data-toc-id="${markedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [markedId]);

  return (
    <aside className="flex shrink-0 flex-col border-r border-border bg-card" style={{ width }}>
      <div className="flex h-12 shrink-0 items-center gap-1.5 px-3">
        <ListTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">Contents</span>
        {nodes.length > 0 && <span className="text-[11px] text-muted-foreground">{nodes.length}</span>}
      </div>

      {error && (
        <div className="m-2 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading contents...</span>
          </div>
        )}

        {!loading && nodes.length === 0 && !error && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No table of contents for this book. Add one from the book's Edit dialog on the home page.
          </p>
        )}

        {!loading &&
          visible.map((node) => {
            const isParent = parents.has(node.id);
            const isOpen = !collapsed.has(node.id);
            const isActive = node.id === markedId;
            // The number printed on the paper is what a reader recognises; the
            // scan index it maps to stays in the tooltip.
            const badge = node.printedPage ?? node.page;

            return (
              <div
                key={node.id}
                data-toc-id={node.id}
                className={`flex items-center gap-1 rounded-sm py-[3px] pr-2 ${
                  isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                }`}
                style={{ paddingLeft: 6 + (node.depth - 1) * 14 }}
              >
                {isParent ? (
                  <button
                    onClick={() => toggle(node.id)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-accent"
                    title={isOpen ? "Collapse" : "Expand"}
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="h-4 w-4 shrink-0" />
                )}

                <button
                  onClick={() => node.page !== null && onJump(node.page)}
                  disabled={node.page === null}
                  title={
                    node.page === null
                      ? node.title
                      : node.printedPage === null
                        ? `PDF page ${node.page}`
                        : `Book page ${node.printedPage} · PDF page ${node.page}`
                  }
                  className={`flex min-w-0 flex-1 items-baseline gap-2 text-left text-xs ${
                    node.page === null ? "cursor-default" : ""
                  } ${node.depth === 1 ? "font-medium text-foreground" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  {badge !== null && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{badge}</span>
                  )}
                </button>
              </div>
            );
          })}
      </div>
    </aside>
  );
}
