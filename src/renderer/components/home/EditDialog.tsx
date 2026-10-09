import { useState, useRef, useCallback, useEffect } from "react";
import { clearBookToc, fetchBookToc, replaceBookToc, replaceCover, replaceOcr } from "@/api/pdfs";
import type { PdfDocument } from "@/types";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, AlertCircle, FileJson, ImageIcon, ListTree } from "lucide-react";

interface EditDialogProps {
  open: boolean;
  pdf: PdfDocument | null;
  onClose: () => void;
  onSuccess: () => void;
}

type UploadState = "idle" | "uploading" | "success" | "error";

/** Absolute path of a picked File, via the preload bridge. */
function absolutePathOf(file: File): string | null {
  const resolved = window.api.files.getPath(file);
  return resolved && resolved.length > 0 ? resolved : null;
}

export function EditDialog({ open, pdf, onClose, onSuccess }: EditDialogProps) {
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [tocFile, setTocFile] = useState<File | null>(null);
  // Dropping the outline needs no file, so it is a pending choice like the
  // pickers above rather than an action of its own — Cancel still undoes it.
  const [removeToc, setRemoveToc] = useState(false);
  const [hasToc, setHasToc] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  // Field-level messages stay next to the field they are about.
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const tocInputRef = useRef<HTMLInputElement>(null);

  // Knowing whether an outline exists is what decides between "remove" and
  // nothing to remove at all.
  useEffect(() => {
    if (!open || !pdf) return;
    let cancelled = false;
    fetchBookToc(pdf.id)
      .then((toc) => {
        if (!cancelled) setHasToc(toc !== null);
      })
      .catch(() => {
        // A missing or unreadable outline is not this dialog's problem; the
        // picker still lets the user replace it.
        if (!cancelled) setHasToc(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pdf]);

  const handleClose = useCallback(() => {
    setJsonFile(null);
    setCoverFile(null);
    setTocFile(null);
    setRemoveToc(false);
    setState("idle");
    setServerError(null);
    setJsonError(null);
    setFormError(null);
    onClose();
  }, [onClose]);

  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setJsonFile(file);
    setJsonError(null);
    setFormError(null);
    setServerError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!pdf) return;
    setJsonError(null);
    setFormError(null);

    if (!jsonFile && !coverFile && !tocFile && !removeToc) {
      setFormError("Select a file to update");
      return;
    }

    if (jsonFile) {
      if (!jsonFile.name.toLowerCase().endsWith(".json")) {
        setJsonError("File must be a JSON file");
        return;
      }
      if (jsonFile.size > 50 * 1024 * 1024) {
        setJsonError("JSON file too large (max 50 MB)");
        return;
      }
    }

    if (tocFile && !tocFile.name.toLowerCase().endsWith(".json")) {
      setFormError("Table of contents must be a JSON file");
      return;
    }

    setState("uploading");
    setServerError(null);

    try {
      if (jsonFile) {
        const ocrPath = absolutePathOf(jsonFile);
        if (!ocrPath) throw new Error("Could not resolve the selected file path.");
        await replaceOcr(pdf.id, ocrPath);
      }
      if (coverFile) {
        const coverPath = absolutePathOf(coverFile);
        if (!coverPath) throw new Error("Could not resolve the selected file path.");
        await replaceCover(pdf.id, coverPath);
      }
      if (tocFile) {
        const tocPath = absolutePathOf(tocFile);
        if (!tocPath) throw new Error("Could not resolve the selected file path.");
        await replaceBookToc(pdf.id, tocPath);
      } else if (removeToc && hasToc) {
        await clearBookToc(pdf.id);
      }
      setState("success");
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 800);
    } catch (err) {
      setState("error");
      setServerError(err instanceof Error ? err.message : "Update failed");
    }
  }, [pdf, jsonFile, coverFile, tocFile, removeToc, hasToc, onSuccess, handleClose]);

  if (!open || !pdf) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={state !== "uploading" ? handleClose : undefined} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        {state !== "uploading" && (
          <button onClick={handleClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        )}

        <h2 className="text-lg font-semibold text-foreground mb-1">Edit: {pdf.title}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Update OCR JSON, cover image or table of contents.
        </p>

        {/* OCR JSON */}
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">Replace OCR JSON</label>
          <div
            onClick={() => jsonInputRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
              jsonError ? "border-destructive bg-destructive/5" : jsonFile ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20" : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <FileJson className={`h-7 w-7 shrink-0 ${jsonFile ? "text-emerald-500" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              {jsonFile ? (
                <p className="text-sm font-medium truncate">{jsonFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select new OCR JSON</p>
              )}
            </div>
          </div>
          {jsonError && <p className="mt-1 text-xs text-destructive">{jsonError}</p>}
          <input ref={jsonInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleJsonChange} />
        </div>

        {/* Cover image */}
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">Cover Image (optional)</label>
          <div
            onClick={() => coverInputRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
              coverFile ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20" : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <ImageIcon className={`h-7 w-7 shrink-0 ${coverFile ? "text-emerald-500" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              {coverFile ? (
                <p className="text-sm font-medium truncate">{coverFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Click to select cover image</p>
              )}
            </div>
          </div>
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setCoverFile(f); setServerError(null); }} />
        </div>

        {/* Table of contents */}
        <div className="mb-6">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium text-foreground">Table of Contents JSON</label>
            {hasToc && (
              <button
                onClick={() => {
                  setRemoveToc((previous) => !previous);
                  setTocFile(null);
                  setFormError(null);
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
              >
                {removeToc ? "Keep current" : "Remove current"}
              </button>
            )}
          </div>
          <div
            onClick={() => {
              if (removeToc) return;
              tocInputRef.current?.click();
            }}
            className={`flex items-center gap-3 rounded-lg border-2 border-dashed p-3 transition-colors ${
              removeToc
                ? "border-destructive/50 bg-destructive/5"
                : tocFile
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                  : "cursor-pointer border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <ListTree
              className={`h-7 w-7 shrink-0 ${
                removeToc ? "text-destructive" : tocFile ? "text-emerald-500" : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0">
              {removeToc ? (
                <p className="text-sm text-destructive">Table of contents will be removed on save</p>
              ) : tocFile ? (
                <p className="text-sm font-medium truncate">{tocFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {hasToc ? "Click to replace the table of contents" : "Click to add a table of contents"}
                </p>
              )}
            </div>
          </div>
          <input
            ref={tocInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              setTocFile(e.target.files?.[0] ?? null);
              setRemoveToc(false);
              setFormError(null);
              setServerError(null);
            }}
          />
        </div>

        {formError && !serverError && (
          <p className="mb-4 text-xs text-destructive">{formError}</p>
        )}

        {serverError && state === "error" && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={handleClose} disabled={state === "uploading"}>Cancel</Button>
          <Button onClick={handleSave} disabled={state === "uploading"} className="gap-2">
            {state === "uploading" ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</> : state === "success" ? "✓ Done!" : <><Upload className="h-4 w-4" /> Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
