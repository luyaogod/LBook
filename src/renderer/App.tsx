import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { HomePage } from "@/components/home/HomePage";
import { UploadDialog } from "@/components/home/UploadDialog";
import { EditDialog } from "@/components/home/EditDialog";
import type { PdfDocument, OcrBlock } from "@/types";
import type { Settings } from "@shared/ipc";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { FlowViewer } from "@/components/viewer/FlowViewer";
import { OcrSidebar } from "@/components/sidebar/OcrSidebar";
import { TocPanel } from "@/components/toc/TocPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { usePdfDocument } from "@/hooks/usePdfDocument";
import { usePdfPage } from "@/hooks/usePdfPage";
import { useBookToc } from "@/hooks/useBookToc";
import { fetchReadingProgress, saveReadingProgress } from "@/api/users";
import { savePdf } from "@/api/pdfs";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  const [appSettings, setAppSettings] = useState<Settings | null>(null);

  // Read once at startup so the settings panel opens on the stored values (theme
  // included) instead of fetching on every open.
  useEffect(() => {
    window.api.settings
      .get()
      .then(setAppSettings)
      .catch(() => setAppSettings(null));
  }, []);

  return (
    <ThemeProvider settings={appSettings} onSettings={setAppSettings}>
      <AppShell appSettings={appSettings} setAppSettings={setAppSettings} />
    </ThemeProvider>
  );
}

interface AppShellProps {
  appSettings: Settings | null;
  setAppSettings: (settings: Settings) => void;
}

function AppShell({ appSettings, setAppSettings }: AppShellProps) {
  const [selectedPdfId, setSelectedPdfId] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedBlockId, setHighlightedBlockId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [showUpload, setShowUpload] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
  // The table of contents sits to the left of the page and is independently
  // collapsible, so a reader who only wants the OCR text can put it away.
  const [tocOpen, setTocOpen] = useState(true);
  const [tocWidth, setTocWidth] = useState(280);
  // The OCR panel can be hidden entirely (the toolbar brings it back) or blown
  // up to the full width, which is how you proof-read a long page of text.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [dragTarget, setDragTarget] = useState<"toc" | "sidebar" | null>(null);
  // Edits live in the working copy until written back into the .lbook, the way
  // a spreadsheet holds changes until you save.
  const [docDirty, setDocDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const docDirtyRef = useRef(false);
  docDirtyRef.current = docDirty;
  const dragStartX = useRef(0);
  const dragStartW = useRef(480);
  const initialFitDone = useRef(false);
  const saveProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The book a queued progress save belongs to.
   *
   * Reading progress is written 2s after the last page change, and that delay is
   * exactly the window in which the reader can open another book. The callback that
   * scheduled the write captured the *old* `selectedPdfId`, so a report from the
   * book being opened landed in the previous book's row: measured, opening book B
   * (saved at 98) while book A was at 120 rewrote A's row to 98. Every queued save
   * therefore carries its `pdfId` and drops itself if the reader has moved on.
   */
  const progressSaveOwnerRef = useRef<number | null>(null);
  const selectedPdfIdRef = useRef<number | null>(null);
  selectedPdfIdRef.current = selectedPdfId;

  const scheduleProgressSave = useCallback((pdfId: number, page: number, delayMs = 2000) => {
    if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
    progressSaveOwnerRef.current = pdfId;
    saveProgressTimerRef.current = setTimeout(() => {
      saveProgressTimerRef.current = null;
      if (selectedPdfIdRef.current !== pdfId) return;
      saveReadingProgress(pdfId, page).catch(() => {});
    }, delayMs);
  }, []);

  const handleResizeStart = useCallback(
    (target: "toc" | "sidebar") => (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartX.current = e.clientX;
      dragStartW.current = target === "toc" ? tocWidth : sidebarWidth;
      setDragTarget(target);
    },
    [tocWidth, sidebarWidth]
  );

  useEffect(() => {
    if (dragTarget === null) return;
    const handleMove = (e: MouseEvent) => {
      if (dragTarget === "sidebar") {
        // The OCR sidebar is dragged from its left edge, so it grows leftwards.
        const delta = dragStartX.current - e.clientX;
        setSidebarWidth(Math.min(800, Math.max(240, dragStartW.current + delta)));
      } else {
        const delta = e.clientX - dragStartX.current;
        setTocWidth(Math.min(480, Math.max(180, dragStartW.current + delta)));
      }
    };
    const handleUp = () => setDragTarget(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragTarget]);

  const { pdf, loading: pdfLoading, error: pdfError } = usePdfDocument(selectedPdfId);
  const { page, loading: pageLoading } = usePdfPage(selectedPdfId, currentPage);
  const { toc, nodes: tocNodes, loading: tocLoading, error: tocError } = useBookToc(selectedPdfId);

  // Opening the panel re-reads the settings (they may have been changed by a
  // previous window state); the startup read already happened in App.
  const openSettings = useCallback(() => {
    setShowSettings(true);
    window.api.settings
      .get()
      .then(setAppSettings)
      .catch(() => undefined);
  }, [setAppSettings]);

  const totalPages = pdf?.page_count ?? 1;
  // Width the open contents panel takes away from the page, handle included.
  const tocSpace = tocOpen ? tocWidth + 6 : 0;
  // Only an open, non-expanded OCR panel competes with the page for width.
  const sidebarSpace = sidebarOpen && !sidebarExpanded ? sidebarWidth + 6 : 0;
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
    setCurrentPage(1); // default, will be overridden if progress exists
    // Reset the flow-mode cursor too. It belongs to the book being closed, and in
    // flow mode it is the page the sidebar and the viewer read — leaving it set
    // lets the previous book's page be reported (and saved) as this book's.
    setVisiblePage(1);
    setHighlightedBlockId(null);
    setPageSize({ width: 0, height: 0 });
    setDocDirty(false);
    initialFitDone.current = false;

    // A save queued for the book we are leaving must not fire against this one.
    if (saveProgressTimerRef.current) {
      clearTimeout(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
    }

    // Restore last read page
    fetchReadingProgress(id)
      .then((progress) => {
        // null means this book has never been opened — stay on page 1.
        if (progress && progress.last_page_num >= 1) {
          setCurrentPage(progress.last_page_num);
          setVisiblePage(progress.last_page_num);
        }
      })
      .catch(() => {
        // Stay on page 1 rather than blocking the viewer.
      });
  }, []);

  const handleSave = useCallback(async () => {
    if (selectedPdfId === null || saving) return;
    setSaving(true);
    try {
      await savePdf(selectedPdfId);
      setDocDirty(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save the book.");
    } finally {
      setSaving(false);
    }
  }, [selectedPdfId, saving]);

  const handleBlockEdited = useCallback(() => setDocDirty(true), []);

  const handleBack = useCallback(() => {
    // Save reading progress immediately before navigating away
    if (saveProgressTimerRef.current) {
      clearTimeout(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
    }
    if (selectedPdfId !== null) {
      const pageToSave = flowMode ? visiblePage : currentPage;
      saveReadingProgress(selectedPdfId, pageToSave).catch(() => {});
    }
    if (docDirtyRef.current) {
      const leave = window.confirm(
        "This book has edits that have not been written into the .lbook yet.\n\n" +
          "They stay in the app, but the file on disk is unchanged.\n" +
          "Leave without saving?",
      );
      if (!leave) return;
    }
    setDocDirty(false);
    setSelectedPdfId(null);
  }, [selectedPdfId, currentPage, visiblePage, flowMode]);

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
        // Debounced save reading progress
        if (selectedPdfId !== null) scheduleProgressSave(selectedPdfId, page);
      }
    },
    [totalPages, flowMode, selectedPdfId, scheduleProgressSave]
  );

  // Keyboard shortcuts: N = next page, B = previous page
  const handlePageChangeRef = useRef(handlePageChange);
  handlePageChangeRef.current = handlePageChange;
  const sidebarPageNumRef = useRef(sidebarPageNum);
  sidebarPageNumRef.current = sidebarPageNum;
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    if (selectedPdfId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      // Ctrl/Cmd+S saves the working copy back into the .lbook.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveRef.current();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n" || key === "b") {
        e.preventDefault();
        const cur = sidebarPageNumRef.current;
        handlePageChangeRef.current(key === "n" ? cur + 1 : cur - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPdfId]);

  const handleVisiblePageChange = useCallback(
    (pageNum: number, blocks: OcrBlock[], markdownText: string | null) => {
      setVisiblePage(pageNum);
      setVisiblePageBlocks(blocks);
      setVisiblePageMarkdown(markdownText);
      // Save progress when scrolling in flow mode. `selectedPdfId` here can be one
      // render behind a book switch, which is why the queued save is tagged and
      // re-checked when it fires.
      if (selectedPdfId !== null) scheduleProgressSave(selectedPdfId, pageNum);
    },
    [selectedPdfId, scheduleProgressSave]
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
        // Save progress when exiting flow mode
        if (selectedPdfId !== null) {
          saveReadingProgress(selectedPdfId, visiblePage).catch(() => {});
        }
      }
    },
    [currentPage, visiblePage, selectedPdfId]
  );

  const handleWheelZoom = useCallback((delta: number) => {
    setScale((s) => {
      const step = delta > 0 ? 0.1 : -0.1;
      return +Math.min(3.0, Math.max(0.3, +(s + step).toFixed(1)));
    });
  }, []);

  const handleFitWidth = useCallback(() => {
    if (pageSize.width > 0) {
      const availW = window.innerWidth - sidebarSpace - tocSpace - 48;
      const newScale = availW / pageSize.width;
      setScale(+Math.min(3.0, Math.max(0.3, newScale)).toFixed(1));
    }
  }, [pageSize.width, sidebarSpace, tocSpace]);

  const handlePageSizeReady = useCallback((width: number, height: number) => {
    setPageSize({ width, height });
    if (!initialFitDone.current && width > 0 && height > 0) {
      initialFitDone.current = true;
      const availW = window.innerWidth - sidebarSpace - tocSpace - 48;
      const availH = window.innerHeight - 56 - 48 - 48;
      const fitScale = Math.min(availW / width, availH / height);
      setScale(+Math.min(3.0, Math.max(0.3, fitScale)).toFixed(1));
    }
  }, [sidebarSpace, tocSpace]);

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
        <AppHeader
          mode="home"
          onUploadClick={() => setShowUpload(true)}
          onSettingsClick={openSettings}
        />
        <UpdateBanner />
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
        <SettingsDialog
          open={showSettings}
          settings={appSettings}
          onClose={() => setShowSettings(false)}
          onSettings={setAppSettings}
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
      <AppHeader
        mode="viewer"
        fileName={pdf?.title}
        onBack={handleBack}
        dirty={docDirty}
      />
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: table of contents */}
        {tocOpen && (
          <>
            <TocPanel
              key={selectedPdfId}
              nodes={tocNodes}
              loading={tocLoading}
              error={tocError}
              currentPage={sidebarPageNum}
              width={tocWidth}
              onJump={handlePageChange}
            />
            <div
              className={`relative shrink-0 w-1.5 cursor-col-resize group bg-[#f8fafc] dark:bg-background ${dragTarget === "toc" ? "!bg-[#0090f1]" : "hover:bg-[#0090f1]/30"}`}
              onMouseDown={handleResizeStart("toc")}
            >
              {/* The PDF toolbar's bottom border stops at this 6px handle, which
                  would leave the divider looking broken at both ends. Carry it
                  across: the same 48px box plus its own border-b lands the two lines
                  on the same pixel (`h-12` is border-box, so the border is the last
                  of those 48). */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-12 border-b border-border" />
              {dragTarget === "toc" && (
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#0090f1]" />
              )}
            </div>
          </>
        )}
        {/* Middle: toolbar + viewer. Hidden while the OCR panel is expanded,
            which has no page area to sit next to. */}
        {!sidebarExpanded && (
          <>
            <div className="flex flex-1 flex-col min-w-0">
              <PdfToolbar
                scale={scale}
                pageNum={sidebarPageNum}
                totalPages={totalPages}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onPageChange={handlePageChange}
                onFitWidth={handleFitWidth}
                tocOpen={tocOpen}
                onToggleToc={() => setTocOpen((open) => !open)}
                hasToc={toc !== null}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => {
                  setSidebarOpen((open) => !open);
                  setSidebarExpanded(false);
                }}
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
            {/* A drag handle only makes sense while there are two columns. */}
            {sidebarOpen && (
              <div
                className={`relative shrink-0 w-1.5 cursor-col-resize group bg-[#f8fafc] dark:bg-background ${dragTarget === "sidebar" ? "!bg-[#0090f1]" : "hover:bg-[#0090f1]/30"}`}
                onMouseDown={handleResizeStart("sidebar")}
              >
                {/* See the left handle: the PDF toolbar's border has to reach the
                    panels on both sides, or it reads as broken at the ends. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-12 border-b border-border" />
                {dragTarget === "sidebar" && (
                  <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-[#0090f1]" />
                )}
              </div>
            )}
          </>
        )}
        {/* Right: sidebar */}
        {sidebarOpen && (
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
            onBlockEdited={handleBlockEdited}
            bookUid={pdf?.uid}
            pdfId={selectedPdfId}
            expanded={sidebarExpanded}
            onExpandedChange={setSidebarExpanded}
            onCollapse={() => {
              setSidebarOpen(false);
              setSidebarExpanded(false);
            }}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            scrollToPage={flowScrollToPage}
            onScrollToPageHandled={handleFlowScrollToPageHandled}
            onVisiblePageChange={handleVisiblePageChange}
            onOpenSettings={openSettings}
          />
        )}
      </div>

      <SettingsDialog
        open={showSettings}
        settings={appSettings}
        onClose={() => setShowSettings(false)}
        onSettings={setAppSettings}
      />
    </div>
  );
}

export default App;
