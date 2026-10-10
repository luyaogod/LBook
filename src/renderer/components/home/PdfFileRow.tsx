import type { PdfDocument } from "@/types";
import { ExternalLink, FolderOpen, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfThumbnail } from "./PdfThumbnail";

interface PdfFileRowProps {
  pdf: PdfDocument;
  onOpen: (uid: string) => void;
  /** Shows the book folder in the OS file manager. */
  onReveal: (uid: string) => void;
  /** Forgets the book. The folder and its files are not touched (A11). */
  onRemove: (uid: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * One book in the library list.
 *
 * A book whose folder has gone missing is still listed, greyed out with the reason
 * and only "remove" available: the folder may be on a drive that is not plugged in,
 * and dropping it silently would look like the app lost the book (B8).
 */
export function PdfFileRow({ pdf, onOpen, onReveal, onRemove }: PdfFileRowProps) {
  const broken = pdf.problem !== null;

  return (
    <div
      className={`px-5 py-5 border-b border-border flex items-center gap-4 ${
        broken ? "" : "hover:bg-accent/30 transition-colors cursor-pointer"
      }`}
      onClick={() => {
        if (!broken) onOpen(pdf.uid);
      }}
    >
      {/* The cover is served from the book folder; a book that moved away has none. */}
      <PdfThumbnail coverUrl={broken ? null : pdf.cover_url} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{pdf.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground font-medium">
            PDF
          </span>
          {broken ? (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-800 font-medium dark:bg-amber-500/15 dark:text-amber-300"
              title={pdf.problem ?? ""}
            >
              <TriangleAlert className="h-3 w-3" />
              Needs repair
            </span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{formatFileSize(pdf.file_size)}</span>
              <span className="text-xs text-border">·</span>
              <span className="text-xs text-muted-foreground">{pdf.page_count} pages</span>
              {formatDate(pdf.created_at) && (
                <>
                  <span className="text-xs text-border">·</span>
                  <span className="text-xs text-muted-foreground">{formatDate(pdf.created_at)}</span>
                </>
              )}
            </>
          )}
        </div>
        {broken && (
          <p className="mt-1 text-xs text-muted-foreground truncate" title={pdf.problem ?? ""}>
            {pdf.problem}
          </p>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onReveal(pdf.uid);
        }}
        title="Show this folder in the file manager"
      >
        <FolderOpen className="h-4 w-4" />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(pdf.uid);
        }}
        title="Remove from the library (the files are not deleted)"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {!broken && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(pdf.uid);
          }}
        >
          <span>Open</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
