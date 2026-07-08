import { BookOpen, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  mode: "home" | "viewer";
  fileName?: string;
  onBack?: () => void;
  onUploadClick?: () => void;
}

export function AppHeader({ mode, fileName, onBack, onUploadClick }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      {mode === "viewer" && (
        <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back to home">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}
      <BookOpen className="h-5 w-5 text-primary" />
      <span className="font-semibold text-foreground">LBook</span>
      {mode === "viewer" ? (
        <span className="mx-auto text-sm text-muted-foreground truncate max-w-[50%]">
          {fileName}
        </span>
      ) : (
        <>
          <div className="flex-1" />
          <Button size="sm" className="gap-1.5" onClick={onUploadClick}>
            <Plus className="h-4 w-4" />
            Upload PDF
          </Button>
        </>
      )}
    </header>
  );
}
