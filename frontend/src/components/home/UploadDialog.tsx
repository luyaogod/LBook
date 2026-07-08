import { useState, useRef, useCallback } from "react";
import { uploadPdf } from "@/api/pdfs";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, FileText, FileJson, X, AlertCircle } from "lucide-react";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type UploadState = "idle" | "uploading" | "success" | "error";

interface FieldError {
  pdf?: string;
  json?: string;
}

export function UploadDialog({ open, onClose, onSuccess }: UploadDialogProps) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError>({});
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const validateFields = useCallback((): boolean => {
    const errors: FieldError = {};

    if (!pdfFile) {
      errors.pdf = "Please select a PDF file";
    } else if (!pdfFile.name.toLowerCase().endsWith(".pdf")) {
      errors.pdf = "File must be a PDF";
    } else if (pdfFile.size > 200 * 1024 * 1024) {
      errors.pdf = "PDF file too large (max 200 MB)";
    }

    if (!jsonFile) {
      errors.json = "Please select an OCR JSON file";
    } else if (!jsonFile.name.toLowerCase().endsWith(".json")) {
      errors.json = "File must be a JSON file";
    } else if (jsonFile.size > 50 * 1024 * 1024) {
      errors.json = "JSON file too large (max 50 MB)";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [pdfFile, jsonFile]);

  const handleUpload = useCallback(async () => {
    if (!pdfFile || !jsonFile) return;
    if (!validateFields()) return;

    setState("uploading");
    setServerError(null);

    try {
      await uploadPdf(pdfFile, jsonFile);
      setState("success");
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 800);
    } catch (err) {
      setState("error");
      setServerError(err instanceof Error ? err.message : "Upload failed");
    }
  }, [pdfFile, jsonFile, validateFields, onSuccess]);

  const handleClose = useCallback(() => {
    setPdfFile(null);
    setJsonFile(null);
    setState("idle");
    setServerError(null);
    setFieldErrors({});
    onClose();
  }, [onClose]);

  const handlePdfChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setPdfFile(file);
      setFieldErrors((prev) => ({ ...prev, pdf: undefined }));
      setServerError(null);
    },
    []
  );

  const handleJsonChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setJsonFile(file);
      setFieldErrors((prev) => ({ ...prev, json: undefined }));
      setServerError(null);
    },
    []
  );

  if (!open) return null;

  const canUpload = pdfFile && jsonFile && state !== "uploading";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={state !== "uploading" ? handleClose : undefined}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        {/* Close button */}
        {state !== "uploading" && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}

        <h2 className="text-lg font-semibold text-foreground mb-1">
          Upload PDF + OCR Data
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Select a PDF file and its PaddleOCR JSON output.
        </p>

        {/* PDF file input */}
        <div className="mb-4">
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            PDF File
          </label>
          <div
            onClick={() => pdfInputRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors ${
              fieldErrors.pdf
                ? "border-destructive bg-destructive/5"
                : pdfFile
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                  : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <FileText
              className={`h-8 w-8 shrink-0 ${
                pdfFile ? "text-emerald-500" : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0">
              {pdfFile ? (
                <>
                  <p className="text-sm font-medium text-foreground truncate">
                    {pdfFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(pdfFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Click to select a PDF file
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Max 200 MB
                  </p>
                </>
              )}
            </div>
          </div>
          {fieldErrors.pdf && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.pdf}</p>
          )}
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={handlePdfChange}
          />
        </div>

        {/* JSON file input */}
        <div className="mb-6">
          <label className="text-sm font-medium text-foreground mb-1.5 block">
            OCR JSON File
          </label>
          <div
            onClick={() => jsonInputRef.current?.click()}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors ${
              fieldErrors.json
                ? "border-destructive bg-destructive/5"
                : jsonFile
                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                  : "border-border hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <FileJson
              className={`h-8 w-8 shrink-0 ${
                jsonFile ? "text-emerald-500" : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0">
              {jsonFile ? (
                <>
                  <p className="text-sm font-medium text-foreground truncate">
                    {jsonFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(jsonFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Click to select a JSON file
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PaddleOCR-VL output format
                  </p>
                </>
              )}
            </div>
          </div>
          {fieldErrors.json && (
            <p className="mt-1 text-xs text-destructive">{fieldErrors.json}</p>
          )}
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleJsonChange}
          />
        </div>

        {/* Server error */}
        {serverError && state === "error" && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={state === "uploading"}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!canUpload}
            className="gap-2"
          >
            {state === "uploading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : state === "success" ? (
              <>
                <span className="text-emerald-300">✓</span>
                Done!
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
