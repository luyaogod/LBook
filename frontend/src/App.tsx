import { useState, useCallback, useMemo, useRef } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { HomePage } from "@/components/home/HomePage";
import { UploadDialog } from "@/components/home/UploadDialog";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { OcrSidebar } from "@/components/sidebar/OcrSidebar";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { usePdfPage } from "@/hooks/usePdfPage";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  const [selectedPdfId, setSelectedPdfId] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedBlockId, setHighlightedBlockId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [overlayOpaque, setOverlayOpaque] = useState(false);
  const initialFitDone = useRef(false);

  const { pdf, loading: pdfLoading, error: pdfError } = usePdfDocument(selectedPdfId);
  const { page, loading: pageLoading } = usePdfPage(selectedPdfId, currentPage);

  const totalPages = pdf?.page_count ?? 1;
  const blocks = page?.blocks ?? [];
  const pageBlocks = useMemo(
    () => blocks.filter((b) => !["image", "header_image", "footer_image"].includes(b.block_label)),
    [blocks]
  );

  const handleOpenPdf = useCallback((id: number) => {
    setSelectedPdfId(id);
    setCurrentPage(1);
    setHighlightedBlockId(null);
    setPageSize({ width: 0, height: 0 });
    initialFitDone.current = false;
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPdfId(null);
  }, []);

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

  const handleWheelZoom = useCallback((delta: number) => {
    setScale((s) => {
      const step = delta > 0 ? 0.1 : -0.1;
      return +Math.min(3.0, Math.max(0.3, +(s + step).toFixed(1)));
    });
  }, []);

  const handleFitWidth = useCallback(() => {
    if (pageSize.width > 0) {
      const availW = window.innerWidth - 480 - 48;
      const newScale = availW / pageSize.width;
      setScale(+Math.min(3.0, Math.max(0.3, newScale)).toFixed(1));
    }
  }, [pageSize.width]);

  const handlePageSizeReady = useCallback((width: number, height: number) => {
    setPageSize({ width, height });
    if (!initialFitDone.current && width > 0 && height > 0) {
      initialFitDone.current = true;
      const availW = window.innerWidth - 480 - 48;
      const availH = window.innerHeight - 56 - 48 - 48;
      const fitScale = Math.min(availW / width, availH / height);
      setScale(+Math.min(3.0, Math.max(0.3, fitScale)).toFixed(1));
    }
  }, []);

  const handleBlockHover = useCallback((id: number | null) => {
    setHighlightedBlockId(id);
  }, []);

  const handleUploadSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Home page
  if (selectedPdfId === null) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="home" onUploadClick={() => setShowUpload(true)} />
        <HomePage onOpenPdf={handleOpenPdf} refreshKey={refreshKey} />
        <UploadDialog
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      </div>
    );
  }

  // Viewer: loading (or pdf not yet set)
  if (pdfLoading || !pdf) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="viewer" onBack={handleBack} />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Loading document...</span>
          </div>
        </div>
      </div>
    );
  }

  // Viewer: error
  if (pdfError) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="viewer" onBack={handleBack} />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-semibold text-foreground">Failed to load document</p>
              <p className="mt-1 text-sm text-muted-foreground">{pdfError}</p>
            </div>
            <Button variant="outline" onClick={handleBack}>
              Back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Viewer: normal
  return (
    <div className="flex h-svh flex-col bg-background">
      <AppHeader mode="viewer" fileName={pdf?.file_name} onBack={handleBack} />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: toolbar + viewer */}
        <div className="flex flex-1 flex-col min-w-0">
          <PdfToolbar
            scale={scale}
            pageNum={currentPage}
            totalPages={totalPages}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onPageChange={handlePageChange}
            onFitWidth={handleFitWidth}
          />
          <PdfViewer
            pdfId={selectedPdfId}
            pageNum={currentPage}
            scale={scale}
            blocks={pageBlocks}
            highlightedBlockId={highlightedBlockId}
            onBlockHover={handleBlockHover}
            onPageSizeReady={handlePageSizeReady}
            ocrPageWidth={page?.page_width ?? null}
            ocrPageHeight={page?.page_height ?? null}
            overlayOpaque={overlayOpaque}
            onWheelZoom={handleWheelZoom}
          />
        </div>
        {/* Right: sidebar */}
        <OcrSidebar
          blocks={pageBlocks}
          pageNum={currentPage}
          highlightedBlockId={highlightedBlockId}
          onBlockHover={handleBlockHover}
          loading={pageLoading}
          markdownText={page?.markdown_text ?? null}
          overlayOpaque={overlayOpaque}
          onOverlayOpaqueChange={setOverlayOpaque}
        />
      </div>
    </div>
  );
}

export default App;
