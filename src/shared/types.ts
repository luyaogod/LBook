/**
 * Domain types shared by the main process, the preload bridge and the renderer.
 * Kept free of `electron` and Node imports so tests can use them directly.
 */

export interface PdfDocument {
  id: number
  /** Stable identity from manifest.json; all lbook:// URLs use it. */
  uid: string
  title: string
  author: string | null
  page_count: number
  /** Uncompressed size of book.pdf, in bytes. */
  file_size: number
  status: string
  /** `lbook://cover/<uid>` when the package has a cover, else null. */
  cover_url: string | null
  created_at: string
  /** True when edits have not been written back into the .lbook yet. */
  dirty: boolean
}

export interface OcrPageBrief {
  id: number
  page_num: number
  page_width: number | null
  page_height: number | null
}

export interface OcrBlock {
  id: number
  block_index: number
  block_label: string
  block_content: string | null
  block_bbox: [number, number, number, number]
  block_order: number | null
  group_id: number | null
}

export interface OcrPage extends OcrPageBrief {
  pdf_id: number
  markdown_text: string | null
  blocks: OcrBlock[]
}

export interface PdfDocumentDetail extends PdfDocument {
  data_info: string | null
  pages: OcrPageBrief[]
}

export interface User {
  id: number
  username: string
  created_at: string
}

export interface ReadingProgress {
  id: number
  user_id: number
  pdf_id: number
  last_page_num: number
  updated_at: string
}

export interface BookCoverRef {
  name: string
  mime: string
}

/**
 * One entry of a book's table of contents.
 *
 * `page` is the 1-based page index **inside the scanned PDF** — the page the
 * viewer actually navigates to. It is not the page number printed on the paper:
 * a scan whose front matter is unnumbered shifts every printed number by a
 * constant, and that constant is nowhere in the PDF. `printedPage` records the
 * printed number for display only, so a reader can still see "第 3 页" while the
 * viewer jumps to scan page 6.
 */
export interface TocNode {
  title: string
  /** Null for a group heading that only holds children. */
  page: number | null
  /** Page number printed on the paper, when it differs from `page`. Display only. */
  printedPage?: number | null
  children?: TocNode[]
}

/** The optional `toc.json` entry of a .lbook package. */
export interface BookToc {
  version: number
  /** Free-form provenance note, e.g. where the outline was transcribed from. */
  source?: string | null
  nodes: TocNode[]
}

/** The `manifest.json` entry of a .lbook package. */
export interface BookManifest {
  format: "lbook"
  formatVersion: number
  uid: string
  title: string
  author: string | null
  createdAt: string
  pageCount: number
  pdfSize: number
  pdfSha256: string
  hasOcr: boolean
  cover: BookCoverRef | null
  generator: string
}
