import { useState, useCallback, useMemo } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { OcrSidebar } from "@/components/sidebar/OcrSidebar";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { usePdfPage } from "@/hooks/usePdfPage";
import { Loader2, AlertTriangle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

// v1: hardcoded to the first imported document
const PDF_ID = 1;

function App() {
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedBlockId, setHighlightedBlockId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });

  const { pdf, loading: pdfLoading, error: pdfError } = usePdfDocument(PDF_ID);
  const { page } = usePdfPage(PDF_ID, currentPage);

  const totalPages = pdf?.page_count ?? 1;
  const blocks = page?.blocks ?? [];

  // Derived: blocks on this page
  const pageBlocks = useMemo(() => blocks, [blocks]);

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(3.0, +(s + 0.1).toFixed(1)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(0.3, +(s - 0.1).toFixed(1)));
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page);
        setHighlightedBlockId(null);
      }
    },
    [totalPages]
  );

  const handleFitWidth = useCallback(() => {
    if (pageSize.width > 0) {
      // Estimate available width (viewer area minus some padding)
      const viewerWidth = window.innerWidth - 480 - 40; // minus sidebar and padding
      const newScale = viewerWidth / pageSize.width;
      setScale(+Math.min(3.0, Math.max(0.3, newScale)).toFixed(1));
    }
  }, [pageSize.width]);

  const handlePageSizeReady = useCallback((width: number, height: number) => {
    setPageSize({ width, height });
  }, []);

  const handleBlockHover = useCallback((id: number | null) => {
    setHighlightedBlockId(id);
  }, []);

  // Loading state for PDF document
  if (pdfLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">Loading document...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (pdfError) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <p className="font-semibold text-foreground">Failed to load document</p>
            <p className="mt-1 text-sm text-muted-foreground">{pdfError}</p>
          </div>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // No documents imported yet
  if (!pdf) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <BookOpen className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">No documents found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run the import script to add a PDF with OCR data:
              <br />
              <code className="mt-2 block rounded bg-muted px-3 py-1.5 text-xs">
                uv run python scripts/import_ocr.py --pdf &lt;path&gt; --ocr &lt;path&gt;
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background">
      <AppHeader fileName={pdf.file_name} />
      <PdfToolbar
        scale={scale}
        pageNum={currentPage}
        totalPages={totalPages}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onPageChange={handlePageChange}
        onFitWidth={handleFitWidth}
      />
      <div className="flex flex-1 overflow-hidden">
        <PdfViewer
          pdfId={PDF_ID}
          pageNum={currentPage}
          scale={scale}
          blocks={pageBlocks}
          highlightedBlockId={highlightedBlockId}
          onBlockHover={handleBlockHover}
          onPageSizeReady={handlePageSizeReady}
        />
        <OcrSidebar
          blocks={pageBlocks}
          pageNum={currentPage}
          highlightedBlockId={highlightedBlockId}
          onBlockHover={handleBlockHover}
        />
      </div>
    </div>
  );
}

export default App;
