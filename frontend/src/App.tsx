import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { HomePage } from "@/components/home/HomePage";
import { UploadDialog } from "@/components/home/UploadDialog";
import { EditDialog } from "@/components/home/EditDialog";
import type { PdfDocument, OcrBlock } from "@/types";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { FlowViewer } from "@/components/viewer/FlowViewer";
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
  const [editPdf, setEditPdf] = useState<PdfDocument | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [overlayOpaque, setOverlayOpaque] = useState(false);
  const [flowMode, setFlowMode] = useState(false);
  const [visiblePage, setVisiblePage] = useState(1);
  const [visiblePageBlocks, setVisiblePageBlocks] = useState<OcrBlock[]>([]);
  const [visiblePageMarkdown, setVisiblePageMarkdown] = useState<string | null>(null);
  const [flowScrollToPage, setFlowScrollToPage] = useState<number | null>(null);
  const [flowPagesData, setFlowPagesData] = useState<Array<{
    pageNum: number;
    blocks: OcrBlock[];
    markdownText: string | null;
  }>>([]);
  const [scrollTarget, setScrollTarget] = useState<{ id: number; from: "sidebar" | "overlay" } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(480);
  const [dragging, setDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(480);
  const initialFitDone = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartW.current = sidebarWidth;
    setDragging(true);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const delta = dragStartX.current - e.clientX;
      setSidebarWidth(Math.min(800, Math.max(240, dragStartW.current + delta)));
    };
    const handleUp = () => setDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const { pdf, loading: pdfLoading, error: pdfError } = usePdfDocument(selectedPdfId);
  const { page, loading: pageLoading } = usePdfPage(selectedPdfId, currentPage);

  const totalPages = pdf?.page_count ?? 1;
  const blocks = page?.blocks ?? [];
  const pageBlocks = useMemo(
    () => blocks.filter((b) => !["image", "header_image", "footer_image"].includes(b.block_label)),
    [blocks]
  );

  // Sidebar data: in flow mode, use visible page data; otherwise use current page data
  const sidebarBlocks = flowMode ? visiblePageBlocks : pageBlocks;
  const sidebarPageNum = flowMode ? visiblePage : currentPage;
  const sidebarMarkdown = flowMode ? visiblePageMarkdown : (page?.markdown_text ?? null);
  const sidebarLoading = flowMode ? false : pageLoading;

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
        if (flowMode) {
          setFlowScrollToPage(page);
        } else {
          setCurrentPage(page);
          setHighlightedBlockId(null);
        }
      }
    },
    [totalPages, flowMode]
  );

  const handleVisiblePageChange = useCallback(
    (pageNum: number, blocks: OcrBlock[], markdownText: string | null) => {
      setVisiblePage(pageNum);
      setVisiblePageBlocks(blocks);
      setVisiblePageMarkdown(markdownText);
    },
    []
  );

  const handleFlowScrollToPageHandled = useCallback(() => {
    setFlowScrollToPage(null);
  }, []);

  const handleFlowPagesChange = useCallback(
    (pages: Array<{ pageNum: number; blocks: OcrBlock[]; markdownText: string | null }>) => {
      setFlowPagesData(pages);
    },
    []
  );

  const handleFlowModeToggle = useCallback(
    (v: boolean) => {
      if (v) {
        // Entering flow mode: start from current page
        setVisiblePage(currentPage);
        setFlowMode(true);
      } else {
        // Exiting flow mode: go to the page that was visible in flow
        setCurrentPage(visiblePage);
        setFlowMode(false);
        setHighlightedBlockId(null);
      }
    },
    [currentPage, visiblePage]
  );

  const handleWheelZoom = useCallback((delta: number) => {
    setScale((s) => {
      const step = delta > 0 ? 0.1 : -0.1;
      return +Math.min(3.0, Math.max(0.3, +(s + step).toFixed(1)));
    });
  }, []);

  const handleFitWidth = useCallback(() => {
    if (pageSize.width > 0) {
      const availW = window.innerWidth - sidebarWidth - 48;
      const newScale = availW / pageSize.width;
      setScale(+Math.min(3.0, Math.max(0.3, newScale)).toFixed(1));
    }
  }, [pageSize.width]);

  const handlePageSizeReady = useCallback((width: number, height: number) => {
    setPageSize({ width, height });
    if (!initialFitDone.current && width > 0 && height > 0) {
      initialFitDone.current = true;
      const availW = window.innerWidth - sidebarWidth - 48;
      const availH = window.innerHeight - 56 - 48 - 48;
      const fitScale = Math.min(availW / width, availH / height);
      setScale(+Math.min(3.0, Math.max(0.3, fitScale)).toFixed(1));
    }
  }, []);

  const handleBlockHover = useCallback((id: number | null) => {
    setHighlightedBlockId(id);
  }, []);

  const handleBlockClick = useCallback((id: number, from: "sidebar" | "overlay") => {
    setScrollTarget({ id, from });
  }, []);

  const handleUploadSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Home page
  if (selectedPdfId === null) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="home" onUploadClick={() => setShowUpload(true)} />
        <HomePage onOpenPdf={handleOpenPdf} refreshKey={refreshKey} onEditPdf={setEditPdf} />
        <UploadDialog
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
        <EditDialog
          open={editPdf !== null}
          pdf={editPdf}
          onClose={() => setEditPdf(null)}
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
            pageNum={sidebarPageNum}
            totalPages={totalPages}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onPageChange={handlePageChange}
            onFitWidth={handleFitWidth}
            flowMode={flowMode}
          />
          {flowMode ? (
            <FlowViewer
              pdfId={selectedPdfId}
              scale={scale}
              overlayOpaque={overlayOpaque}
              highlightedBlockId={highlightedBlockId}
              onBlockHover={handleBlockHover}
              onBlockClick={(id) => handleBlockClick(id, "overlay")}
              onVisiblePageChange={handleVisiblePageChange}
              onVisiblePagesChange={handleFlowPagesChange}
              scrollToBlockId={scrollTarget?.from === "sidebar" ? scrollTarget.id : null}
              scrollToPage={flowScrollToPage}
              onScrollToPageHandled={handleFlowScrollToPageHandled}
              onWheelZoom={handleWheelZoom}
              initialPage={currentPage}
            />
          ) : (
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
              scrollToBlockId={scrollTarget?.from === "sidebar" ? scrollTarget.id : null}
              onBlockClick={(id) => handleBlockClick(id, "overlay")}
            />
          )}
        </div>
        {/* Resize handle */}
        <div
          className={`relative shrink-0 w-1.5 cursor-col-resize group ${dragging ? "bg-[#0090f1]" : "hover:bg-[#0090f1]/30"}`}
          onMouseDown={handleResizeStart}
        >
          {dragging && <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#0090f1]" />}
        </div>
        {/* Right: sidebar */}
        <OcrSidebar
          blocks={sidebarBlocks}
          pageNum={sidebarPageNum}
          highlightedBlockId={highlightedBlockId}
          onBlockHover={handleBlockHover}
          loading={sidebarLoading}
          markdownText={sidebarMarkdown}
          overlayOpaque={overlayOpaque}
          onOverlayOpaqueChange={setOverlayOpaque}
          onBlockClick={(id) => handleBlockClick(id, "sidebar")}
          scrollToBlockId={scrollTarget?.from === "overlay" ? scrollTarget.id : null}
          width={sidebarWidth}
          flowMode={flowMode}
          onFlowModeChange={handleFlowModeToggle}
          flowPagesData={flowPagesData}
        />
      </div>
    </div>
  );
}

export default App;
