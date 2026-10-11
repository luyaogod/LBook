import { useCallback, useEffect, useState } from "react";
import type { ReplaceRole } from "@shared/ipc";
import type { PdfDocument } from "@/types";
import { pickFile, replaceBookFile } from "@/api/pdfs";
import { writeErrorText } from "@/lib/writeError";

import { Button } from "@/components/ui/button";
import { Check, FileText, FolderOpen, Image as ImageIcon, ListTree, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface EditBookDialogProps {
  open: boolean;
  pdf: PdfDocument | null;
  onClose: () => void;
  /** Fired after a successful change, so the app can re-read the book. */
  onChanged: () => void;
  /** Opens the book folder or one of its files in the OS. */
  onShowFile: (uid: string, role: "folder" | "ocr" | "meta" | "toc" | "pdf" | "cover") => void;
}

type Busy = ReplaceRole | null;

/**
 * Maintaining a book: replace one of its files, or rename it.
 *
 * The four files are the whole surface, because they are the whole book:
 * `ocr.json` (the text), the cover, `toc.json` (the outline) and `book.pdf` (the
 * scan). Each replacement is a file picker followed by a validated copy — the app
 * checks the new file the same way it checks files when creating a book, so a bad
 * replacement is refused and the old file stays where it was.
 *
 * Nothing here edits *inside* a file: the app does not rewrite the reader's OCR
 * text or outline, it swaps the whole file (A5 as narrowed by A17).
 */
export function EditBookDialog({ open, pdf, onClose, onChanged, onShowFile }: EditBookDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReplaceRole | null>(null);
  /** Where the book ended up after a title change, or why its folder could not follow. */
  const [titleNote, setTitleNote] = useState<string | null>(null);
  const [titleWarning, setTitleWarning] = useState<{ text: string; detail: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(pdf?.title ?? "");
    setBusy(null);
    setError(null);
    setDone(null);
  }, [open, pdf]);

  const replace = useCallback(
    async (role: ReplaceRole, kind: "ocr" | "cover" | "toc" | "pdf") => {
      if (pdf === null) return;
      const file = await pickFile(kind);
      if (file === null) return;

      setBusy(role);
      setError(null);
      setDone(null);
      try {
        const outcome = await replaceBookFile(pdf.uid, role, file);
        if (!outcome.ok) {
          setError(outcome.error);
          return;
        }
        setDone(role);
        onChanged();
      } finally {
        setBusy(null);
      }
    },
    [pdf, onChanged],
  );

  const saveTitle = useCallback(async () => {
    if (pdf === null || title.trim() === "" || title === pdf.title) return;
    setBusy("title");
    setError(null);
    setDone(null);
    setTitleNote(null);
    setTitleWarning(null);
    try {
      const outcome = await replaceBookFile(pdf.uid, "title", title.trim());
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const folderName = typeof outcome.value.folderName === "string" ? outcome.value.folderName : null;
      setDone("title");
      // The folder follows the title, so saying which folder it is now is part of the answer
      // — the reader is about to see a different name in their file manager.
      setTitleNote(
        outcome.value.folderRenamed === true && folderName !== null
          ? t("editBook.titleAndFolderSaved", { folder: folderName })
          : t("editBook.titleSaved"),
      );
      // A partial result is reported as one: the name is saved, the folder is not, and the
      // reader can try again (something is holding a file inside it).
      const problem = outcome.value.folderProblem;
      if (problem !== undefined && problem !== null) {
        setTitleWarning({
          text: writeErrorText(t, problem),
          detail: problem.error,
        });
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }, [pdf, title, onChanged, t]);

  if (!open || pdf === null) return null;

  const rows: Array<{ role: ReplaceRole; kind: "ocr" | "cover" | "toc" | "pdf"; label: string; hint: string; icon: React.ReactNode }> = [
    {
      role: "ocr",
      kind: "ocr",
      label: t("editBook.ocr"),
      hint: t("editBook.ocrHint"),
      icon: <FileText className="h-4 w-4" />,
    },
    {
      role: "cover",
      kind: "cover",
      label: t("editBook.cover"),
      hint: t("editBook.coverHint"),
      icon: <ImageIcon className="h-4 w-4" />,
    },
    {
      role: "toc",
      kind: "toc",
      label: t("editBook.toc"),
      hint: t("editBook.tocHint"),
      icon: <ListTree className="h-4 w-4" />,
    },
    {
      role: "pdf",
      kind: "pdf",
      label: t("editBook.pdf"),
      hint: t("editBook.pdfHint"),
      icon: <FileText className="h-4 w-4" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex w-[620px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
            {t("editBook.title", { name: pdf.title })}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            title={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t("editBook.hint")}</p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("editBook.name")}</span>
              <div className="flex items-center gap-2">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || title.trim() === "" || title === pdf.title}
                  onClick={() => void saveTitle()}
                >
                  {busy === "title" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("common.save")}
                </Button>
              </div>
              <span className="text-[11px] text-muted-foreground">{t("editBook.nameHint")}</span>
              {/* Said before the click, not after: the folder in the reader's file manager
                  changes name too (A22, Obsidian's rule). */}
              <span className="text-[11px] text-muted-foreground">{t("editBook.renameHint")}</span>
            </label>

            {rows.map((row) => (
              <div
                key={row.role}
                className="flex items-center gap-3 border-t border-border pt-3"
              >
                <span className="w-6 shrink-0 text-muted-foreground">{row.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{row.label}</p>
                  <p className="text-[11px] text-muted-foreground">{row.hint}</p>
                </div>
                {done === row.role && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={busy !== null}
                  onClick={() => void replace(row.role, row.kind)}
                >
                  {busy === row.role ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t("editBook.replace")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => onShowFile(pdf.uid, row.kind)}
                  title={t("common.showInFolder")}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            {error !== null && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {done !== null && error === null && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {done === "title"
                  ? (titleNote ?? t("editBook.titleSaved"))
                  : t("editBook.fileReplaced")}
              </p>
            )}
            {titleWarning !== null && (
              <p
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
                title={titleWarning.detail}
              >
                {titleWarning.text}
              </p>
            )}
          </div>
        </div>

        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-t border-border px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShowFile(pdf.uid, "folder")}
            title={t("book.openFolder")}
          >
            <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
            {t("editBook.showFolder")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
