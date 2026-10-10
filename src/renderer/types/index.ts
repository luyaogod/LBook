/**
 * Re-exported from the shared contract so main, preload and renderer can never
 * drift apart on the shape of a document.
 */
export type {
  BookToc,
  OcrBlock,
  OcrPage,
  OcrPageBrief,
  PdfDocument,
  ReadingProgress,
  TocNode,
} from "@shared/types"
