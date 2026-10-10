import { Bolt, BookOpen, ChevronRight, FolderPlus } from "lucide-react";
import { WindowControls } from "./WindowControls";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
  mode: "home" | "viewer";
  fileName?: string;
  /** Returns to the library. The breadcrumb is the only affordance left for it. */
  onBack?: () => void;
  /** Opens the folder picker that adds a book. */
  onAddBookClick?: () => void;
  /** Opens the settings panel. Present in both modes: see the button below. */
  onSettingsClick?: () => void;
}

/**
 * The app's own top row, and — because the window has no OS title bar — also the
 * window's drag handle.
 *
 * There is deliberately no Save button and no unsaved marker: the app never
 * writes to a book (A5 in `.agents/plan/00-decisions.md`), so there is nothing to
 * save and nothing that can be out of step with the disk.
 *
 * The right edge stays clear of the native window buttons Electron draws over
 * it (`titleBarOverlay`), hence the fixed padding.
 */
export function AppHeader({
  mode,
  fileName,
  onBack,
  onAddBookClick,
  onSettingsClick,
}: AppHeaderProps) {
  return (
    <header className="drag-region flex h-14 shrink-0 items-center gap-2 border-b border-border pl-4">
      <BookOpen className="h-5 w-5 text-primary shrink-0" />

      {/* Breadcrumb */}
      {mode === "viewer" ? (
        <div className="flex items-center gap-1.5 text-sm min-w-0">
          <button
            onClick={onBack}
            title="Back to library"
            className="no-drag rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            LBook
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-foreground font-medium truncate">{fileName}</span>
        </div>
      ) : (
        <span className="font-semibold text-foreground">LBook</span>
      )}

      {/* Spacer + actions */}
      <div className="flex-1" />
      {mode === "home" && (
        <Button size="sm" className="no-drag gap-1.5" onClick={onAddBookClick}>
          <FolderPlus className="h-4 w-4" />
          Add book
        </Button>
      )}
      {/* Always present, in both modes. It started out as home-only, which was
          backwards: the setting it now carries (reading font size) is one you
          reach for *while reading*, and the reader is exactly where the button
          was missing. */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="no-drag"
        onClick={onSettingsClick}
        title="Settings"
      >
        <Bolt className="h-4 w-4" />
      </Button>

      <WindowControls />
    </header>
  );
}
