import { useCallback, useEffect, useState } from "react";
import type { CreateBookPreview, OpenBookOutcome } from "@shared/ipc";
import type { PdfDocument } from "@/types";
import { createBook, openBookFolder, pickFile, pickFolder, previewBook } from "@/api/pdfs";
import { Button } from "@/components/ui/button";
import {
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ListTree,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface AddBookDialogProps {
  open: boolean;
  /** Where a new book goes unless the reader picks somewhere else. */
  defaultDestination: string;
  onClose: () => void;
  /** Called with the finished book; the app opens it. */
  onCreated: (doc: PdfDocument) => void;
  /** Called for a book that already existed and was just registered. */
  onOpened: (doc: PdfDocument) => void;
  /** Fired when a folder was brought into the `.lbook` layout. */
  onReport?: (message: string) => void;
}

type Tab = "files" | "folder";

/**
 * Adding a book, the two ways there are.
 *
 * **From files** is the one that matters: pick the PDF, its PaddleOCR output, and
 * optionally a cover and a table of contents, then choose where the folder goes. The
 * app validates every file, works out the folder name and reports the page count
 * *before* anything is written — checking a JSON payload and naming a folder are the
 * app's job, not the reader's (A17).
 *
 * **From a folder** is for a book somebody handed over: it is registered as it is,
 * and any loose metadata is moved into its `.lbook` directory on the way.
 */
export function AddBookDialog({
  open,
  defaultDestination,
  onClose,
  onCreated,
  onOpened,
  onReport,
}: AddBookDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("files");

  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [ocrPath, setOcrPath] = useState<string | null>(null);
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [tocPath, setTocPath] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState(defaultDestination);

  const [preview, setPreview] = useState<CreateBookPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderOutcome, setFolderOutcome] = useState<OpenBookOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  // Every open starts clean: a half-filled form from last time is worse than an
  // empty one, because it makes "create" look ready when it is not.
  useEffect(() => {
    if (!open) return;
    setTab("files");
    setPdfPath(null);
    setOcrPath(null);
    setCoverPath(null);
    setTocPath(null);
    setTitle("");
    setDestination(defaultDestination);
    setPreview(null);
    setFolderOutcome(null);
    setBusy(false);
    setCopied(false);
  }, [open, defaultDestination]);

  // The preview runs as the choices change, debounced: it scans the OCR file, which
  // costs about 30ms on a real one, and the destination is a text field.
  useEffect(() => {
    if (!open || pdfPath === null || ocrPath === null || destination.trim() === "") {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewBook({
        pdfPath,
        ocrPath,
        coverPath,
        tocPath,
        title: title.trim() === "" ? undefined : title.trim(),
        destination,
      })
        .then((result) => {
          if (!cancelled) setPreview(result);
        })
        .catch(() => {
          if (!cancelled) setPreview({ ok: false, error: t("addBook.previewFailed") });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, pdfPath, ocrPath, coverPath, tocPath, title, destination, t]);

  const choose = useCallback(
    async (kind: "pdf" | "ocr" | "cover" | "toc", set: (value: string | null) => void) => {
      const file = await pickFile(kind);
      if (file !== null) set(file);
    },
    [],
  );

  const chooseDestination = useCallback(async () => {
    const folder = await pickFolder(destination);
    if (folder !== null) setDestination(folder);
  }, [destination]);

  const handleCreate = useCallback(async () => {
    if (pdfPath === null || ocrPath === null) return;
    setBusy(true);
    try {
      const outcome = await createBook({
        pdfPath,
        ocrPath,
        coverPath,
        tocPath,
        title: title.trim() === "" ? undefined : title.trim(),
        destination,
      });
      if (!outcome.ok) {
        setPreview({ ok: false, error: outcome.error });
        return;
      }
      onCreated(outcome.value);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [pdfPath, ocrPath, coverPath, tocPath, title, destination, onCreated, onClose]);

  const handleOpenFolder = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await openBookFolder();
      if (outcome === null) return; // the reader closed the picker
      setFolderOutcome(outcome);
      if (!outcome.ok) return;
      if (outcome.moved.length > 0) {
        onReport?.(t("addBook.movedFiles", { count: outcome.moved.length, name: outcome.doc.title }));
      }
      if (outcome.adopted) {
        onOpened(outcome.doc);
        onClose();
      } else {
        setCopied(true);
        onReport?.(t("addBook.alreadyKnown", { name: outcome.doc.title }));
      }
    } finally {
      setBusy(false);
    }
  }, [onOpened, onClose, onReport, t]);

  if (!open) return null;

  const canCreate = preview?.ok === true && !busy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <h2 className="text-base font-semibold text-foreground">{t("addBook.title")}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            title={t("common.close")}
          >
            ✕
          </button>
        </div>

        {/* Two ways in, as two tabs rather than a wizard: a reader knows which one
            they want before they get here. */}
        <div className="flex shrink-0 gap-1 border-b border-border px-4 pt-3">
          {(["files", "folder"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-t-md px-3 py-2 text-sm ${
                tab === id
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {id === "files" ? t("addBook.tabFiles") : t("addBook.tabFolder")}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "files" ? (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">{t("addBook.filesHint")}</p>

              <SourceRow
                icon={<FileText className="h-4 w-4" />}
                label={t("addBook.pdf")}
                hint={t("addBook.pdfHint")}
                value={pdfPath}
                placeholder={t("addBook.choose")}
                onChoose={() => void choose("pdf", setPdfPath)}
                onClear={() => setPdfPath(null)}
              />
              <SourceRow
                icon={<FileText className="h-4 w-4" />}
                label={t("addBook.ocr")}
                hint={t("addBook.ocrHint")}
                value={ocrPath}
                placeholder={t("addBook.choose")}
                onChoose={() => void choose("ocr", setOcrPath)}
                onClear={() => setOcrPath(null)}
              />
              <SourceRow
                icon={<ImageIcon className="h-4 w-4" />}
                label={t("addBook.cover")}
                hint={t("addBook.optional")}
                value={coverPath}
                placeholder={t("addBook.choose")}
                onChoose={() => void choose("cover", setCoverPath)}
                onClear={() => setCoverPath(null)}
              />
              <SourceRow
                icon={<ListTree className="h-4 w-4" />}
                label={t("addBook.toc")}
                hint={t("addBook.optional")}
                value={tocPath}
                placeholder={t("addBook.choose")}
                onChoose={() => void choose("toc", setTocPath)}
                onClear={() => setTocPath(null)}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">{t("addBook.name")}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={preview?.ok ? preview.title : t("addBook.nameFromFile")}
                  className="h-9 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("addBook.destination")}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
                  />
                  <Button variant="outline" size="sm" onClick={() => void chooseDestination()}>
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    {t("addBook.browse")}
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground">{t("addBook.destinationHint")}</span>
              </div>

              {/* What would be created, before anything is. */}
              {preview && preview.ok && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                  <p className="text-foreground">
                    {t("addBook.willCreate", { name: preview.folderName })}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t("common.pages", { count: preview.pageCount })} ·{" "}
                    {(preview.ocrBytes / 1048576).toFixed(1)}MB · {preview.dir}
                  </p>
                  {preview.warnings.map((warning) => (
                    <p key={warning} className="mt-1 text-amber-600 dark:text-amber-400">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
              {preview && !preview.ok && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{preview.error}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">{t("addBook.folderHint")}</p>
              <Button variant="outline" size="sm" className="self-start" onClick={() => void handleOpenFolder()}>
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                {t("addBook.chooseFolder")}
              </Button>
              {folderOutcome && !folderOutcome.ok && (
                <p className="text-xs text-destructive">{folderOutcome.error}</p>
              )}
              {folderOutcome?.ok && copied && (
                <p className="text-xs text-muted-foreground">
                  {t("addBook.alreadyKnown", { name: folderOutcome.doc.title })}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex h-16 shrink-0 items-center justify-end gap-2 border-t border-border px-6">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          {tab === "files" && (
            <Button size="sm" onClick={() => void handleCreate()} disabled={!canCreate}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {t("addBook.create")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface SourceRowProps {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: string | null;
  placeholder: string;
  onChoose: () => void;
  onClear: () => void;
}

/** One file the reader can pick: what it is, what they chose, and how to change it. */
function SourceRow({ icon, label, hint, value, placeholder, onChoose, onClear }: SourceRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground" title={value ?? hint}>
          {value ?? hint}
        </p>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onChoose}>
        {placeholder}
      </Button>
      {value !== null && (
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onClear}>
          ✕
        </Button>
      )}
    </div>
  );
}
