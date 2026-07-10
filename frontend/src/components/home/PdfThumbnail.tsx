import { getCoverUrl } from "@/api/pdfs";
import { FileText } from "lucide-react";

interface PdfThumbnailProps {
  pdfId: number;
  coverPath: string | null;
}

export function PdfThumbnail({ pdfId, coverPath }: PdfThumbnailProps) {
  const hasCover = coverPath && coverPath.length > 0;

  return (
    <div className="w-14 h-20 rounded flex items-center justify-center shrink-0 bg-muted relative overflow-hidden">
      {hasCover ? (
        <img
          src={getCoverUrl(pdfId)}
          alt="Cover"
          className="w-full h-full object-cover"
        />
      ) : (
        <FileText className="h-6 w-6 text-muted-foreground" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-foreground/5" />
    </div>
  );
}
