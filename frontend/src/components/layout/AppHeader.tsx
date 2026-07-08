import { BookOpen } from "lucide-react";

interface AppHeaderProps {
  fileName: string;
}

export function AppHeader({ fileName }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <BookOpen className="h-5 w-5 text-primary" />
      <span className="font-semibold text-foreground">LBook</span>
      <span className="mx-auto text-sm text-muted-foreground truncate max-w-[50%]">
        {fileName}
      </span>
    </header>
  );
}
