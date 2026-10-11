import { Button } from "@/components/ui/button";
import { PageNav } from "./PageNav";
import { Minus, Plus, Maximize, ListTree, PanelRightOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PdfToolbarProps {
  scale: number;
  pageNum: number;
  totalPages: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPageChange: (page: number) => void;
  onFitWidth: () => void;
  /** Whether the left-hand table of contents is showing. */
  tocOpen: boolean;
  onToggleToc: () => void;
  /** False when the book has no toc.json, so the button reads as "none yet". */
  hasToc: boolean;
  /** Whether the right-hand OCR panel is showing. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function PdfToolbar({
  scale,
  pageNum,
  totalPages,
  onZoomIn,
  onZoomOut,
  onPageChange,
  onFitWidth,
  tocOpen,
  onToggleToc,
  hasToc,
  sidebarOpen,
  onToggleSidebar,
}: PdfToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      {/* Contents toggle — the leftmost control because it opens the leftmost panel */}
      <Button
        variant={tocOpen ? "secondary" : "ghost"}
        size="icon-sm"
        onClick={onToggleToc}
        title={
          tocOpen
            ? t("viewer.hideContents")
            : hasToc
              ? t("viewer.showContents")
              : t("viewer.showContentsNoToc")
        }
      >
        <ListTree className="h-4 w-4" />
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Zoom controls */}
      <Button variant="ghost" size="icon-sm" onClick={onZoomOut} disabled={scale <= 0.3}>
        <Minus className="h-4 w-4" />
      </Button>
      <span className="w-14 text-center text-xs tabular-nums text-muted-foreground">
        {Math.round(scale * 100)}%
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onZoomIn} disabled={scale >= 3.0}>
        <Plus className="h-4 w-4" />
      </Button>

      <Button variant="ghost" size="icon-sm" onClick={onFitWidth} title={t("viewer.fitWidth")}>
        <Maximize className="h-4 w-4" />
      </Button>

      {/* Page navigation */}
      <div className="ml-auto">
        <PageNav pageNum={pageNum} totalPages={totalPages} onPageChange={onPageChange} />
      </div>

      {/* OCR panel toggle — mirrors the contents toggle on the far left */}
      <div className="mx-1 h-5 w-px bg-border" />
      <Button
        variant={sidebarOpen ? "secondary" : "ghost"}
        size="icon-sm"
        onClick={onToggleSidebar}
        title={sidebarOpen ? t("viewer.hideOcrPanel") : t("viewer.showOcrPanel")}
      >
        <PanelRightOpen className="h-4 w-4" />
      </Button>
    </div>
  );
}
