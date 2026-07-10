import { useState, useRef, useCallback } from "react";
import { replaceOcr, uploadCover } from "@/api/pdfs";
import type { PdfDocument } from "@/types";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, AlertCircle, FileJson, ImageIcon } from "lucide-react";

interface EditDialogProps {
  open: boolean;
  pdf: PdfDocument | null;
  onClose: () => void;
  onSuccess: () => void;
}

type UploadState = "idle" | "uploading" | "success" | "error";

export function EditDialog({ open, pdf, onClose, onSuccess }: EditDialogProps) {
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setJsonFile(null);
    setCoverFile(null);
    setState("idle");
    setServerError(null);
    setJsonError(null);
    onClose();
  }, [onClose]);

  const handleJsonChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setJsonFile(file);
    setJsonError(null);
    setServerError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!pdf) return;
    let hasError = false;

    if (!jsonFile && !coverFile) {
      setJsonError("Select a file to update");
      return;
    }

    if (jsonFile) {
      if (!jsonFile.name.toLowerCase().endsWith(".json")) {
        setJsonError("File must be a JSON file");
        hasError = true;
      }
      if (jsonFile.size > 50 * 1024 * 1024) {
        setJsonError("JSON file too large (max 50 MB)");
        hasError = true;
      }
    }
    if (hasError) return;

    setState("uploading");
    setServerError(null);

    try {
      if (jsonFile) await replaceOcr(pdf.id, jsonFile);
      if (coverFile) await uploadCover(pdf.id, coverFile);
      setState("success");
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 800);
    } catch (err) {
      setState("error");
      setServerError(err instanceof Error ? err.message : "Update failed");
    }
  }, [pdf, jsonFile, coverFile, onSuccess, handleClose]);

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

        <h2 className="text-lg font-semibold text-foreground mb-1">Edit: {pdf.file_name}</h2>
        <p className="text-sm text-muted-foreground mb-6">Update OCR JSON or cover image.</p>

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
        <div className="mb-6">
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
