import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PdfThumbnailProps {
  /** `lbook://cover/<uid>` when the package has a cover, otherwise null. */
  coverUrl: string | null;
}

export function PdfThumbnail({ coverUrl }: PdfThumbnailProps) {
  const { t } = useTranslation();

  return (
    <div className="w-14 h-20 rounded flex items-center justify-center shrink-0 bg-muted relative overflow-hidden">
      {coverUrl ? (
        <img src={coverUrl} alt={t("book.cover")} className="w-full h-full object-cover" />
      ) : (
        <FileText className="h-6 w-6 text-muted-foreground" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-foreground/5" />
    </div>
  );
}
