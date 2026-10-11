import { useState, useEffect, useCallback } from "react";
import type { BookFileKind } from "@shared/ipc";
import { fetchBooks, fetchLeftoverPackages, openBookPath, openLibraryDir as openLibraryDirInShell, removeBook } from "@/api/pdfs";
import type { PdfDocument } from "@/types";
import { PdfFileRow } from "./PdfFileRow";
import { Search, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, AlertTriangle, BookOpen, FolderPlus, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HomePageProps {
  onOpenBook: (uid: string) => void;
  /** Opens the folder picker through the main process. */
  onAddBook: () => void;
  refreshKey?: number;
}

const ITEMS_PER_PAGE = 10;

/**
 * The library list.
 *
 * The app does not scan a folder for books any more: it lists the folders the user
 * registered, wherever they live (A11). "Add a book" therefore picks a folder —
 * no import, no copy, and nothing in the folder is modified except the `meta.json`
 * written when a folder of PaddleOCR output is adopted.
 */
export function HomePage({ onOpenBook, onAddBook, refreshKey = 0 }: HomePageProps) {
  const [pdfs, setPdfs] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [leftovers, setLeftovers] = useState<{ dir: string; files: string[] } | null>(null);
  const [leftoversHidden, setLeftoversHidden] = useState(false);

  // Old `.lbook` packages are not books any more: the app has no reader for them.
  // Migration is a one-time script (A12/A13), so the hint can only point at it — but
  // a silent app that ignores files sitting in its own folder would be worse.
  useEffect(() => {
    fetchLeftoverPackages()
      .then((result) => setLeftovers(result.files.length > 0 ? result : null))
      .catch(() => setLeftovers(null));
  }, [refreshKey, localRefresh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBooks()
      .then((data) => {
        if (!cancelled) {
          setPdfs(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, localRefresh]);

  // The list can change from outside the window (a book added by a second window, a
  // folder that came back, a file edited in the reader's own editor), so follow the
  // main process instead of polling. `onBookChanged` matters because a book's saved
  // or broken state lives in files: editing `meta.json` has to move its row here.
  useEffect(() => window.api.events.onLibraryChanged(() => setLocalRefresh((n) => n + 1)), []);
  useEffect(() => window.api.events.onBookChanged(() => setLocalRefresh((n) => n + 1)), []);

  const handleRefresh = useCallback(() => {
    // Asks main to re-read the folders (and tells every window), then re-fetches.
    void window.api.library.refresh().then(() => setLocalRefresh((n) => n + 1));
  }, []);

  /**
   * Old packages in the default location.
   *
   * The migration is a one-time script rather than an app feature: this build has no
   * zip reader and no database (A12), so the honest thing is to say the command and
   * open the folder rather than offer a button that cannot work.
   */
  const leftoverBanner =
    leftovers && !leftoversHidden ? (
      <div className="mx-auto w-full max-w-4xl px-8 pt-6">
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {leftovers.files.length} old .lbook package
                {leftovers.files.length === 1 ? "" : "s"} in {leftovers.dir}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A book is a folder now, so the app cannot read these. Convert them once,
                from a terminal:
              </p>
              <code className="mt-1.5 block rounded bg-background px-2 py-1 text-xs">
                npm run migrate:folders
              </code>
              <p className="mt-1 text-xs text-muted-foreground">
                It only plans by default — add <code>--apply</code> to write the folders.
                The packages themselves are left exactly where they are.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => void openLibraryDirInShell()}>
                Show the folder
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setLeftoversHidden(true)}>
                Hide
              </Button>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  const handleRemove = useCallback((uid: string) => {
    const book = pdfs.find((item) => item.uid === uid);
    const name = book?.title ?? "this book";
    // The one thing a reader must not be able to misread: this only forgets the
    // folder. Saying it plainly is the whole promise of A11.
    const confirmed = window.confirm(
      `Remove "${name}" from the library?\n\n` +
        "The folder and the files inside it are NOT deleted — the app only stops " +
        "listing it. You can add the folder again at any time.",
    );
    if (!confirmed) return;

    void removeBook(uid).then(() => setLocalRefresh((n) => n + 1));
  }, [pdfs]);

  const handleReveal = useCallback((uid: string, kind: BookFileKind = "folder") => {
    void openBookPath(uid, kind);
  }, []);

  // Filter by search query (client-side)
  const filtered = searchQuery
    ? pdfs.filter((p) => p.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : pdfs;

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(startIdx, startIdx + ITEMS_PER_PAGE);
  const showingEnd = Math.min(startIdx + ITEMS_PER_PAGE, filtered.length);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">Loading documents...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold text-foreground">Failed to load documents</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button variant="outline" onClick={() => setLocalRefresh((n) => n + 1)}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Empty state
  if (pdfs.length === 0) {
    return (
      <div className="flex flex-1 flex-col bg-background overflow-auto">
        {leftoverBanner}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">No books yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a book folder: it holds <strong>book.pdf</strong> and its{" "}
                <strong>PaddleOCR JSON</strong> (plus an optional <strong>toc.json</strong> and
                cover). The book can live anywhere — the app remembers the path and never
                copies or moves your files.
              </p>
            </div>
            <Button className="gap-1.5" onClick={onAddBook}>
              <FolderPlus className="h-4 w-4" />
              Add a book folder
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {leftoverBanner}
      {/* Search bar */}
      <div className="p-6 pb-4 bg-background shrink-0">
        <div className="max-w-4xl mx-auto relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 border border-input rounded-lg pl-10 pr-20 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
          <Button
            size="sm"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8"
          >
            Search
          </Button>
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto w-full px-8 flex flex-col">
          {/* Results header */}
          <div className="py-3 border-b border-border flex items-center justify-between shrink-0">
            <span className="text-sm text-muted-foreground">{filtered.length} results</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleRefresh}
                title="Read the book folders again (an edit in your own editor shows up on its own too)"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
                <span>Newest First</span>
                <ArrowUpDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* File rows */}
          <div className="flex-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                No documents match "{searchQuery}"
              </p>
            ) : (
              pageItems.map((pdf) => (
                <PdfFileRow
                  key={pdf.uid}
                  pdf={pdf}
                  onOpen={onOpenBook}
                  onOpenPath={handleReveal}
                  onRemove={handleRemove}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {filtered.length > ITEMS_PER_PAGE && (
            <div className="py-4 flex items-center justify-between border-t border-border shrink-0">
              <span className="text-xs text-muted-foreground">
                Showing {startIdx + 1}–{showingEnd} of {filtered.length} results
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </Button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <Button
                    key={p}
                    variant={p === currentPage ? "default" : "outline"}
                    size="icon-sm"
                    className="w-8 h-8 text-xs"
                    onClick={() => setCurrentPage(p)}
                  >
                    {p}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
