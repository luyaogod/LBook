import { useCallback, useState } from "react";
import type { PdfDocument } from "@/types";
import type { BookFileKind } from "@shared/ipc";
import type { BookIssue } from "@shared/validateBook";
import { inspectBook } from "@/api/pdfs";
import {
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
  ShieldQuestion,
  CircleAlert,
  FileWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfThumbnail } from "./PdfThumbnail";
import { useTranslation } from "react-i18next";

interface PdfFileRowProps {
  pdf: PdfDocument;
  onOpen: (uid: string) => void;
  /** Opens a folder or a file in whatever the OS uses for it. */
  onOpenPath: (uid: string, kind: BookFileKind) => void;
  /** Opens the maintain dialog. */
  onEdit: (pdf: PdfDocument) => void;
  /** Forgets the book. The folder and its files are not touched (A11). */
  onRemove: (uid: string) => void;
  /**
   * Finds a book the app cannot open, by pointing at the folder it lives in now.
   *
   * The Obsidian answer for a vault that moved outside the app — open the folder as a
   * vault again — which is what makes a path recorded in a ledger the recovery:
   * nothing has to be repaired, the folder just has to be found.
   */
  onLocate: (pdf: PdfDocument) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  // Follows the interface language rather than hard-coding en-US: a date is one of the
  // few places where the written form changes with the language, and "Aug 3" in the
  // middle of Chinese labels reads as a bug.
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Which file an issue is in, as a role the main process can resolve. */
function kindOf(issue: BookIssue): BookFileKind {
  switch (issue.file) {
    case "meta.json":
      return "meta";
    case "ocr.json":
      return "ocr";
    case "toc.json":
      return "toc";
    case "book.pdf":
      return "pdf";
    default:
      return "folder";
  }
}

/**
 * One book in the library list.
 *
 * A book whose folder has gone missing or whose files no longer make sense is still
 * listed — greyed out, with a reason and only "remove" available. Dropping it
 * silently would look like the app lost the book, and the folder may simply be on a
 * drive that is not plugged in (B8).
 *
 * "Check" runs the validation rules over the book and shows what they found, file by
 * file, with the byte offset when the OCR file is the problem. That is the one place
 * in the app where reading the whole OCR file is worth 300ms, so it is behind a
 * button rather than part of the listing.
 */
export function PdfFileRow({ pdf, onOpen, onOpenPath, onEdit, onRemove, onLocate }: PdfFileRowProps) {
  const { t, i18n } = useTranslation();
  const broken = pdf.problem !== null;
  const [issues, setIssues] = useState<BookIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (issues !== null) {
      setIssues(null);
      return;
    }
    setChecking(true);
    setCheckError(null);
    try {
      setIssues(await inspectBook(pdf.uid));
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [issues, pdf.uid]);

  const errors = issues?.filter((issue) => issue.level === "error").length ?? 0;
  const warnings = (issues?.length ?? 0) - errors;

  return (
    <div className="border-b border-border">
      <div
        className={`px-5 py-5 flex items-center gap-4 ${broken ? "" : "hover:bg-accent/30 transition-colors cursor-pointer"}`}
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
                {t("book.needsRepair")}
              </span>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">{formatFileSize(pdf.file_size)}</span>
                <span className="text-xs text-border">·</span>
                <span className="text-xs text-muted-foreground">
                  {t("common.pages", { count: pdf.page_count })}
                </span>
                {formatDate(pdf.created_at, i18n.language) && (
                  <>
                    <span className="text-xs text-border">·</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(pdf.created_at, i18n.language)}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {broken && (
            <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate" title={pdf.problem ?? ""}>
                {pdf.problem}
              </span>
              {/* The reason and the way out on one line. This is Obsidian's "open folder
                  as vault" applied to a book folder that moved: point at where it is now,
                  and main checks the folder really is this book before anything changes. */}
              <button
                className="shrink-0 underline underline-offset-2 hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onLocate(pdf);
                }}
              >
                {t("book.locate")}
              </button>
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            void check();
          }}
          title={t("book.check")}
        >
          {checking ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : issues === null ? (
            <ShieldQuestion className="h-4 w-4" />
          ) : (
            <FileWarning className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(pdf);
          }}
          title={t("editBook.title", { name: pdf.title })}
        >
          <Pencil className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpenPath(pdf.uid, "folder");
          }}
          title={t("book.openFolder")}
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
          title={t("home.removeTitle")}
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
            <span>{t("common.open")}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {(issues !== null || checkError !== null) && (
        <div className="px-5 pb-5 -mt-1">
          {checkError && (
            <p className="text-xs text-destructive">
              {t("book.checkFailed", { message: checkError })}
            </p>
          )}

          {issues !== null && issues.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("book.allGood")}</p>
          )}

          {issues !== null && issues.length > 0 && (
            <div className="rounded-md border border-border divide-y divide-border">
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {errors > 0 && t("book.problems", { count: errors })}
                {errors > 0 && warnings > 0 && ", "}
                {warnings > 0 && t("book.warnings", { count: warnings })}
                {" — "}
                {errors > 0 ? t("book.unreadable") : t("book.readableButOff")}
              </p>
              {issues.map((issue, index) => (
                <div key={index} className="flex items-start gap-2 px-3 py-2">
                  {issue.level === "error" ? (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground">{issue.message}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {issue.file}
                      {issue.jsonPath ? ` · ${issue.jsonPath}` : ""}
                      {issue.offset !== undefined
                        ? ` · ${t("book.byteOffset", { offset: issue.offset })}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    onClick={() => onOpenPath(pdf.uid, kindOf(issue))}
                    title={t("common.openFile")}
                  >
                    {t("common.open")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7 shrink-0"
                    onClick={() => void window.api.library.showInFolder(pdf.uid, kindOf(issue))}
                    title={t("common.showInFolder")}
                  >
                    <FolderSearch className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
