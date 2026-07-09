import { apiGet } from "./client";
import type { PdfDocument, PdfDocumentDetail, OcrPage, OcrPageBrief } from "../types";

const BASE_URL = "http://localhost:8000/api";

export function fetchPdfs(): Promise<PdfDocument[]> {
  return apiGet<PdfDocument[]>("/pdfs/");
}

export function fetchPdfDetail(id: number): Promise<PdfDocumentDetail> {
  return apiGet<PdfDocumentDetail>(`/pdfs/${id}`);
}

export function fetchPdfPages(pdfId: number): Promise<OcrPageBrief[]> {
  return apiGet<OcrPageBrief[]>(`/pdfs/${pdfId}/pages`);
}

export function fetchPdfPage(pdfId: number, pageNum: number): Promise<OcrPage> {
  return apiGet<OcrPage>(`/pdfs/${pdfId}/pages/${pageNum}`);
}

export function getPdfFileUrl(pdfId: number): string {
  return `${BASE_URL}/pdfs/${pdfId}/file`;
}

export async function updateBlock(id: number, blockContent: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/blocks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block_content: blockContent }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Update failed (${res.status})`);
  }
}

export async function uploadPdf(
  pdfFile: File,
  ocrFile: File,
): Promise<PdfDocument> {
  const formData = new FormData();
  formData.append("pdf", pdfFile);
  formData.append("ocr_json", ocrFile);

  const res = await fetch(`${BASE_URL}/pdfs/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Upload failed (${res.status})`);
  }

  return res.json();
}
