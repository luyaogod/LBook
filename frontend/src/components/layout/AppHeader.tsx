import { BookOpen, ChevronRight, Plus, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  mode: "home" | "viewer";
  fileName?: string;
  onBack?: () => void;
  onUploadClick?: () => void;
}

export function AppHeader({ mode, fileName, onBack, onUploadClick }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      <BookOpen className="h-5 w-5 text-primary shrink-0" />

      {/* Breadcrumb */}
      {mode === "viewer" ? (
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            onClick={onBack}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <Home className="h-3.5 w-3.5" />
            <span>LBook</span>
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-foreground font-medium truncate">
            {fileName}
          </span>
        </div>
      ) : (
        <span className="font-semibold text-foreground">LBook</span>
      )}

      {/* Spacer + actions */}
      <div className="flex-1" />
      {mode === "home" ? (
        <Button size="sm" className="gap-1.5" onClick={onUploadClick}>
          <Plus className="h-4 w-4" />
          Upload PDF
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          title="Back to home"
        >
          <Home className="h-4 w-4" />
        </Button>
      )}
    </header>
  );
}
