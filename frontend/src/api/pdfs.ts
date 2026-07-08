import { apiGet } from "./client";
import type { PdfDocument, PdfDocumentDetail, OcrPage, OcrPageBrief } from "../types";

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
  return `http://localhost:8000/api/pdfs/${pdfId}/file`;
}
