import { Button } from "@/components/ui/button";
import { Minus, Plus, ChevronLeft, ChevronRight, Maximize } from "lucide-react";

interface PdfToolbarProps {
  scale: number;
  pageNum: number;
  totalPages: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPageChange: (page: number) => void;
  onFitWidth: () => void;
}

export function PdfToolbar({
  scale,
  pageNum,
  totalPages,
  onZoomIn,
  onZoomOut,
  onPageChange,
  onFitWidth,
}: PdfToolbarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
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

      <Button variant="ghost" size="icon-sm" onClick={onFitWidth} title="Fit width">
        <Maximize className="h-4 w-4" />
      </Button>

      {/* Page navigation */}
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(pageNum - 1)}
          disabled={pageNum <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[100px] text-center text-xs text-muted-foreground">
          Page {pageNum} of {totalPages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(pageNum + 1)}
          disabled={pageNum >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
