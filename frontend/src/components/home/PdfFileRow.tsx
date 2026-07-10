import type { PdfDocument } from "@/types";
import { ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfThumbnail } from "./PdfThumbnail";

interface PdfFileRowProps {
  pdf: PdfDocument;
  onOpen: (id: number) => void;
  onEdit: (pdf: PdfDocument) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PdfFileRow({ pdf, onOpen, onEdit }: PdfFileRowProps) {
  return (
    <div
      className="px-5 py-5 border-b border-border hover:bg-accent/30 transition-colors flex items-center gap-4 cursor-pointer"
      onClick={() => onOpen(pdf.id)}
    >
      <PdfThumbnail pdfId={pdf.id} coverPath={pdf.cover_path} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{pdf.file_name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground font-medium">
            PDF
          </span>
          <span className="text-xs text-muted-foreground">{formatFileSize(pdf.file_size)}</span>
          <span className="text-xs text-border">·</span>
          <span className="text-xs text-muted-foreground">{pdf.page_count} pages</span>
          <span className="text-xs text-border">·</span>
          <span className="text-xs text-muted-foreground">{formatDate(pdf.created_at)}</span>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={(e) => { e.stopPropagation(); onEdit(pdf); }}
        title="Edit OCR / Cover"
      >
        <Pencil className="h-4 w-4" />
      </Button>

      <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={(e) => { e.stopPropagation(); onOpen(pdf.id); }}>
        <span>Open</span>
        <ExternalLink className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
