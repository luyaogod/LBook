import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { UpdateBanner } from "@/components/layout/UpdateBanner";
import { PaneSash } from "@/components/layout/PaneSash";
import { HomePage } from "@/components/home/HomePage";
import { AddBookDialog } from "@/components/home/AddBookDialog";
import { EditBookDialog } from "@/components/home/EditBookDialog";
import type { OcrBlock, PdfDocument } from "@/types";
import type { Settings } from "@shared/ipc";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { usePdfDocumentProxy } from "@/hooks/usePdfDocumentProxy";
import { FlowViewer } from "@/components/viewer/FlowViewer";
import { OcrSidebar } from "@/components/sidebar/OcrSidebar";
import { TocPanel } from "@/components/toc/TocPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { LocaleProvider } from "@/i18n/LocaleProvider";
import { useBook } from "@/hooks/useBook";
import { usePdfPage } from "@/hooks/usePdfPage";
import { useBookToc } from "@/hooks/useBookToc";
import { fetchReadingProgress, saveReadingProgress } from "@/api/users";
import { applyReadingFontSize } from "@/lib/readingFont";
import { useTranslation } from "react-i18next";
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
      {/* The language is applied next to the theme class and for the same reason:
          both are imperative one-liners that belong to <html>, not React state. */}
      <LocaleProvider choice={appSettings?.locale}>
        <AppShell appSettings={appSettings} setAppSettings={setAppSettings} />
      </LocaleProvider>
    </ThemeProvider>
  );
}

interface AppShellProps {
  appSettings: Settings | null;
  setAppSettings: (settings: Settings) => void;
}

function AppShell({ appSettings, setAppSettings }: AppShellProps) {
  const { t } = useTranslation();
  // A book is named by its `uid` (its `meta.json` identity), never by a row id or
  // a path: renaming the folder must not disturb what is open.
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  /**
   * The PDF document, here rather than inside the viewers.
   *
   * Both viewers are mounted conditionally — the page area goes away while the OCR panel is
   * expanded, and flip and scroll are alternatives — and the hook destroys the pdf.js
   * document when it unmounts. Owning it here means one fetch and one parse per book, and
   * switching views is just a different way of drawing the same open document.
   */
  // Named apart from the book's own loading state (below): this is the pdf.js document.
  const { pdfDoc, loading: viewerLoading, error: viewerError } = usePdfDocumentProxy(selectedBookId);
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [highlightedBlockId, setHighlightedBlockId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showAddBook, setShowAddBook] = useState(false);
  const [editBook, setEditBook] = useState<PdfDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const dragStartX = useRef(0);
  const dragStartW = useRef(480);
  const initialFitDone = useRef(false);
  const saveProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The book a queued progress save belongs to.
   *
   * Reading progress is written 2s after the last page change, and that delay is
   * exactly the window in which the reader can open another book. The callback that
   * scheduled the write captured the *old* `selectedBookId`, so a report from the
   * book being opened landed in the previous book's entry: opening book B (saved at
   * 98) while book A was at 120 rewrote A's entry to 98. Every queued save therefore
   * carries its uid and drops itself if the reader has moved on.
   */
  const progressSaveOwnerRef = useRef<string | null>(null);
  const selectedBookIdRef = useRef<string | null>(null);
  selectedBookIdRef.current = selectedBookId;

  const scheduleProgressSave = useCallback((uid: string, page: number, delayMs = 2000) => {
    if (saveProgressTimerRef.current) clearTimeout(saveProgressTimerRef.current);
    progressSaveOwnerRef.current = uid;
    saveProgressTimerRef.current = setTimeout(() => {
      saveProgressTimerRef.current = null;
      if (selectedBookIdRef.current !== uid) return;
      saveReadingProgress(uid, page).catch(() => {});
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

  // `loading` is deliberately not taken: a fetch in flight is not a reason to stop showing a
  // book that is already on screen (see the viewer's loading branch below).
  const { pdf, error: pdfError } = useBook(selectedBookId);

  const { page, loading: pageLoading } = usePdfPage(selectedBookId, currentPage);
  const { toc, nodes: tocNodes, loading: tocLoading, error: tocError } = useBookToc(selectedBookId);

  // Opening the panel re-reads the settings (they may have been changed by a
  // previous window state); the startup read already happened in App.
  const openSettings = useCallback(() => {
    setShowSettings(true);
    window.api.settings
      .get()
      .then(setAppSettings)
      .catch(() => undefined);
  }, [setAppSettings]);

  // The reading font size is a setting, and it reaches CSS as a variable on the
  // root (see lib/readingFont.ts). An effect rather than a render-time write, and
  // it lives here because this is where the settings payload lives — the panels
  // that use the size are three levels down and never see `appSettings`.
  const readingFontSize = appSettings?.readingFontSize;
  useEffect(() => {
    if (readingFontSize !== undefined) applyReadingFontSize(readingFontSize);
  }, [readingFontSize]);

  // One dialog element, reused by every branch below: the settings button is in the
  // header of all of them, so the panel has to exist in all of them too — an early
  // return that forgot it would leave the button looking broken. (The loading one
  // is not a blink: a 70 MB book sits there for a while.)
  const settingsDialog = (
    <SettingsDialog
      open={showSettings}
      settings={appSettings}
      onClose={() => setShowSettings(false)}
      onSettings={setAppSettings}
    />
  );

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

  const handleOpenBook = useCallback((uid: string) => {
    setSelectedBookId(uid);
    setCurrentPage(1); // default, will be overridden if progress exists
    // Reset the flow-mode cursor too. It belongs to the book being closed, and in
    // flow mode it is the page the sidebar and the viewer read — leaving it set
    // lets the previous book's page be reported (and saved) as this book's.
    setVisiblePage(1);
    setHighlightedBlockId(null);
    setPageSize({ width: 0, height: 0 });
    initialFitDone.current = false;

    // A save queued for the book we are leaving must not fire against this one.
    if (saveProgressTimerRef.current) {
      clearTimeout(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
    }

    // Restore last read page
    fetchReadingProgress(uid)
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

  /** The header and the empty state both open the add-a-book dialog. */
  const openAddBook = useCallback(() => setShowAddBook(true), []);

  const handleBack = useCallback(() => {
    // Save reading progress immediately before navigating away
    if (saveProgressTimerRef.current) {
      clearTimeout(saveProgressTimerRef.current);
      saveProgressTimerRef.current = null;
    }
    if (selectedBookId !== null) {
      const pageToSave = flowMode ? visiblePage : currentPage;
      saveReadingProgress(selectedBookId, pageToSave).catch(() => {});
    }
    setSelectedBookId(null);
  }, [selectedBookId, currentPage, visiblePage, flowMode]);

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
        if (selectedBookId !== null) scheduleProgressSave(selectedBookId, page);
      }
    },
    [totalPages, flowMode, selectedBookId, scheduleProgressSave]
  );

  // Keyboard shortcuts: N = next page, B = previous page
  const handlePageChangeRef = useRef(handlePageChange);
  handlePageChangeRef.current = handlePageChange;
  const sidebarPageNumRef = useRef(sidebarPageNum);
  sidebarPageNumRef.current = sidebarPageNum;

  useEffect(() => {
    if (selectedBookId === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
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
  }, [selectedBookId]);

  const handleVisiblePageChange = useCallback(
    (pageNum: number, blocks: OcrBlock[], markdownText: string | null) => {
      setVisiblePage(pageNum);
      setVisiblePageBlocks(blocks);
      setVisiblePageMarkdown(markdownText);
      // Save progress when scrolling in flow mode. `selectedBookId` here can be one
      // render behind a book switch, which is why the queued save is tagged and
      // re-checked when it fires.
      if (selectedBookId !== null) scheduleProgressSave(selectedBookId, pageNum);
    },
    [selectedBookId, scheduleProgressSave]
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
        if (selectedBookId !== null) {
          saveReadingProgress(selectedBookId, visiblePage).catch(() => {});
        }
      }
    },
    [currentPage, visiblePage, selectedBookId]
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

  // Home page
  if (selectedBookId === null) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader
          mode="home"
          onAddBookClick={openAddBook}
          onSettingsClick={openSettings}
        />
        <UpdateBanner />
        <HomePage
          onOpenBook={handleOpenBook}
          onAddBook={() => setShowAddBook(true)}
          onEditBook={setEditBook}
          notice={notice}
          refreshKey={refreshKey}
        />
        <AddBookDialog
          open={showAddBook}
          defaultDestination={appSettings?.libraryDir ?? ""}
          onClose={() => setShowAddBook(false)}
          onCreated={(doc) => {
            setRefreshKey((k) => k + 1);
            handleOpenBook(doc.uid);
          }}
          onOpened={(doc) => {
            setRefreshKey((k) => k + 1);
            handleOpenBook(doc.uid);
          }}
          onReport={(message) => {
            setNotice(message);
            setRefreshKey((k) => k + 1);
          }}
        />
        <EditBookDialog
          open={editBook !== null}
          pdf={editBook}
          onClose={() => setEditBook(null)}
          onChanged={() => setRefreshKey((k) => k + 1)}
          onShowFile={(uid, kind) => window.api.library.openPath(uid, kind)}
        />
        {settingsDialog}
      </div>
    );
  }

  /**
   * Viewer: only while there is nothing of **this** book to show yet.
   *
   * `useBook` sets `loading` for every fetch in flight, and it runs again whenever the book
   * changes — which includes the window regaining focus and every correction we just saved
   * (`book:changed`). Keying this branch on `pdfLoading` therefore replaced the whole viewer
   * with a spinner on each of those, and everything inside it went back to its initial state:
   * the panel's view mode jumped from Blocks to Markdown, the scroll position was lost, an
   * editor that was open closed. That is what "it refreshes when I switch away and back"
   * was, and the fix is to notice that a re-read of the book already on screen is not a
   * reason to stop showing it: `useBook` keeps the previous value, so `pdf` stays.
   *
   * The comparison with `selectedBookId` keeps the switching case honest: opening a different
   * book *should* show the spinner rather than the previous book's pages.
   */
  if (pdf === null || pdf.uid !== selectedBookId) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="viewer" onBack={handleBack} onSettingsClick={openSettings} />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">{t("viewer.loading")}</span>
          </div>
        </div>
        {settingsDialog}
      </div>
    );
  }

  // Viewer: error
  if (pdfError) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <AppHeader mode="viewer" onBack={handleBack} onSettingsClick={openSettings} />
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-center max-w-md">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-semibold text-foreground">{t("viewer.loadFailed")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{pdfError}</p>
            </div>
            <Button variant="outline" onClick={handleBack}>
              {t("viewer.backToHome")}
            </Button>
          </div>
        </div>
        {settingsDialog}
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
        onSettingsClick={openSettings}
      />
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: table of contents */}
        {tocOpen && (
          <>
            <TocPanel
              key={selectedBookId}
              nodes={tocNodes}
              loading={tocLoading}
              error={tocError}
              currentPage={sidebarPageNum}
              width={tocWidth}
              onJump={handlePageChange}
            />
            <PaneSash onMouseDown={handleResizeStart("toc")} dragging={dragTarget === "toc"} />
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
                  bookId={selectedBookId}
                  pdfDoc={pdfDoc}
                  pdfLoading={viewerLoading}
                  pdfError={viewerError}
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
                  pdfDoc={pdfDoc}

                  pdfLoading={viewerLoading}
                  pdfError={viewerError}

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
              <PaneSash onMouseDown={handleResizeStart("sidebar")} dragging={dragTarget === "sidebar"} />
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
            bookUid={selectedBookId}
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

      {settingsDialog}
    </div>
  );
}

export default App;
