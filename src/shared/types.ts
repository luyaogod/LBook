/**
 * Domain types shared by the main process, the preload bridge and the renderer.
 * Kept free of `electron` and Node imports so tests can use them directly.
 */

/**
 * One book, as the library listing sees it.
 *
 * A book is a folder, and its identity is `meta.json.uid` — not a row id, not the
 * folder name. Renaming or moving the folder therefore changes nothing the reader
 * can see (A1 in `.agents/plan/00-decisions.md`).
 */
export interface PdfDocument {
  /** `meta.json.uid`. Every IPC call names a book by this. */
  uid: string
  title: string
  author: string | null
  /** Pages as `meta.json` claims; `status`/`problem` say whether the file agrees. */
  page_count: number
  /** Bytes of `book.pdf`, which the PDF transport needs exactly. */
  file_size: number
  /** `lbook://cover/<uid>` when the folder has a cover file, else null. */
  cover_url: string | null
  created_at: string
  /** Absolute path of the book folder, for "reveal in Explorer". */
  dir: string
  /**
   * Why this book cannot be read right now, or null when it is fine.
   *
   * A book whose folder was moved away is listed like any other — with a reason
   * rather than a hole (B8) — so the reader can see what is wrong and either fix
   * the path themselves or drop the entry.
   */
  problem: string | null
}

export interface OcrPageBrief {
  /** 1-based, matching `layoutParsingResults`' array index (A8). */
  page_num: number
  page_width: number | null
  page_height: number | null
}

/**
 * One block of a page.
 *
 * `block_index` is its identity: it is the position inside the page's
 * `parsing_res_list`, which is the only stable name a block has (there is no id
 * in the OCR file, and none is needed — hover and scroll wiring compares blocks
 * within one page).
 */
export interface OcrBlock {
  block_index: number
  block_label: string
  block_content: string | null
  block_bbox: [number, number, number, number]
  block_order: number | null
  group_id: number | null
}

export interface OcrPage extends OcrPageBrief {
  uid: string
  /** `markdown.text` verbatim. The Markdown view reads this and nothing else (A10). */
  markdown_text: string | null
  /** `prunedResult.parsing_res_list`. The Blocks view reads this and nothing else (A10). */
  blocks: OcrBlock[]
}


export interface ReadingProgress {
  uid: string
  last_page_num: number
  updated_at: string
}

/**
 * One entry of a book's table of contents.
 *
 * `page` is the 1-based page index **inside the scanned PDF** — the page the
 * viewer actually navigates to. It is not the page number printed on the paper:
 * a scan whose front matter is unnumbered shifts every printed number by a
 * constant, and that constant is nowhere in the PDF. `printedPage` records the
 * printed number for display only, so a reader can still see "page 3" on the paper while the
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

/** The optional `toc.json` entry of a book folder. */
export interface BookToc {
  version: number
  /** Free-form provenance note, e.g. where the outline was transcribed from. */
  source?: string | null
  nodes: TocNode[]
}

