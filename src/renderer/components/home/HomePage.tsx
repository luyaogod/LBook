import { useState, useEffect } from "react";
import { fetchPdfs } from "@/api/pdfs";
import type { PdfDocument } from "@/types";
import { PdfFileRow } from "./PdfFileRow";
import { Search, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, AlertTriangle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HomePageProps {
  onOpenPdf: (id: number) => void;
  refreshKey?: number;
  onEditPdf: (pdf: PdfDocument) => void;
}

const ITEMS_PER_PAGE = 10;

export function HomePage({ onOpenPdf, refreshKey = 0, onEditPdf }: HomePageProps) {
  const [pdfs, setPdfs] = useState<PdfDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPdfs()
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

  // Packages can change from outside the window (a rescan, an import, a library
  // move), so follow the main process instead of polling.
  useEffect(() => window.api.events.onLibraryChanged(() => setLocalRefresh((n) => n + 1)), []);

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
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <BookOpen className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">No documents found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Click the <strong>Upload PDF</strong> button above to build a book
              from a PDF and its PaddleOCR JSON output, or drop an existing{" "}
              <strong>.lbook</strong> file into your library folder.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Search bar */}
      <div className="p-6 pb-4 bg-background shrink-0">
        <div className="max-w-4xl mx-auto relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by filename..."
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
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
              <span>Newest First</span>
              <ArrowUpDown className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* File rows */}
          <div className="flex-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">
                No documents match "{searchQuery}"
              </p>
            ) : (
              pageItems.map((pdf) => (
                <PdfFileRow key={pdf.id} pdf={pdf} onOpen={onOpenPdf} onEdit={onEditPdf} />
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
