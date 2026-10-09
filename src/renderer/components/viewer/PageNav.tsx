import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface PageNavProps {
  pageNum: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/**
 * First / previous / "N of M" / next / last.
 *
 * Extracted from the toolbar because the OCR panel needs the same controls when
 * it is expanded over the page area — at that point the toolbar is hidden, and
 * without this the reader could not turn a page at all.
 */
export function PageNav({ pageNum, totalPages, onPageChange }: PageNavProps) {
  // The typed text follows the page number whenever it changes from outside
  // (arrow buttons, the TOC, the keyboard). Adjusting it during render rather
  // than in an effect avoids painting the stale number for one frame.
  const [entry, setEntry] = useState({ page: pageNum, text: String(pageNum) });
  if (entry.page !== pageNum) setEntry({ page: pageNum, text: String(pageNum) });
  const pageInput = entry.text;

  const commit = useCallback(
    (raw: string) => {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 1 && n <= totalPages) {
        onPageChange(n);
      } else {
        setEntry({ page: pageNum, text: String(pageNum) });
      }
    },
    [pageNum, totalPages, onPageChange]
  );

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") commit(pageInput);
    },
    [commit, pageInput]
  );

  return (
    <div className="flex items-center gap-0.5">
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
          onChange={(e) => setEntry({ page: pageNum, text: e.target.value })}
          onKeyDown={handlePageInputKeyDown}
          onBlur={() => commit(pageInput)}
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
  );
}
