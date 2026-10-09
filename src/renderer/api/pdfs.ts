import type {
  BookToc,
  OcrBlock,
  OcrPage,
  OcrPageBrief,
  PdfDocument,
  PdfDocumentDetail,
} from "@shared/types"

/**
 * Thin wrappers over the preload bridge.
 *
 * These used to be REST calls against a localhost FastAPI server; the signatures
 * are kept so the hooks and components above them did not have to change.
 */

export function fetchPdfs(): Promise<PdfDocument[]> {
  return window.api.library.list()
}

export function fetchPdfDetail(id: number): Promise<PdfDocumentDetail | null> {
  return window.api.library.get(id)
}

export function fetchPdfPages(pdfId: number): Promise<OcrPageBrief[]> {
  return window.api.book.listPages(pdfId)
}

export function fetchPdfPage(pdfId: number, pageNum: number): Promise<OcrPage | null> {
  return window.api.book.getPage(pdfId, pageNum)
}

export function updateBlock(id: number, blockContent: string): Promise<OcrBlock> {
  return window.api.book.updateBlock(id, blockContent)
}

/** Writes pending edits back into the .lbook package. */
export function savePdf(pdfId: number): Promise<PdfDocument> {
  return window.api.book.save(pdfId)
}

export function replaceOcr(pdfId: number, ocrPath: string): Promise<PdfDocument> {
  return window.api.book.replaceOcr(pdfId, ocrPath)
}

export function replaceCover(pdfId: number, coverPath: string): Promise<PdfDocument> {
  return window.api.book.replaceCover(pdfId, coverPath)
}

/** The book's table of contents, read from the package's toc.json entry. */
export function fetchBookToc(pdfId: number): Promise<BookToc | null> {
  return window.api.book.getToc(pdfId)
}

/** Writes the chosen toc.json into the package, replacing any existing one. */
export function replaceBookToc(pdfId: number, tocPath: string): Promise<BookToc> {
  return window.api.book.replaceToc(pdfId, tocPath)
}

/** Drops the table of contents entry from the package. */
export function clearBookToc(pdfId: number): Promise<void> {
  return window.api.book.clearToc(pdfId)
}

/** Builds a new .lbook from a loose PDF plus its PaddleOCR output. */
export function createFromFiles(input: {
  pdfPath: string
  ocrPath: string
  coverPath: string | null
  tocPath: string | null
  title?: string
}): Promise<PdfDocument> {
  return window.api.library.createFromFiles(input)
}

/** Adds an existing .lbook package to the library. */
export function importPackage(filePath: string): Promise<PdfDocument> {
  return window.api.library.import(filePath)
}

export function scanLibrary() {
  return window.api.library.scan()
}
