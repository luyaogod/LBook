import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Maximize } from "lucide-react";

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
  const [pageInput, setPageInput] = useState(String(pageNum));

  // Sync input when pageNum changes externally
  useEffect(() => {
    setPageInput(String(pageNum));
  }, [pageNum]);

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const n = parseInt(pageInput, 10);
        if (!isNaN(n) && n >= 1 && n <= totalPages) {
          onPageChange(n);
        } else {
          setPageInput(String(pageNum));
        }
      }
    },
    [pageInput, pageNum, totalPages, onPageChange]
  );

  const handlePageInputBlur = useCallback(() => {
    const n = parseInt(pageInput, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n);
    } else {
      setPageInput(String(pageNum));
    }
  }, [pageInput, pageNum, totalPages, onPageChange]);

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
      <div className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(1)}
          disabled={pageNum <= 1}
          title="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(pageNum - 1)}
          disabled={pageNum <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="number"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handlePageInputKeyDown}
            onBlur={handlePageInputBlur}
            className="w-10 rounded border border-border bg-transparent px-1 py-0.5 text-center text-xs tabular-nums outline-none focus:border-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            min={1}
            max={totalPages}
          />
          <span>of {totalPages}</span>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(pageNum + 1)}
          disabled={pageNum >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onPageChange(totalPages)}
          disabled={pageNum >= totalPages}
          title="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
