export interface PdfDocument {
  id: number;
  file_name: string;
  page_count: number;
  file_size: number;
  status: string;
  cover_path: string | null;
  created_at: string;
}

export interface PdfDocumentDetail extends PdfDocument {
  data_info: string | null;
  pages: OcrPageBrief[];
}

export interface OcrPageBrief {
  id: number;
  page_num: number;
  page_width: number | null;
  page_height: number | null;
}

export interface OcrPage extends OcrPageBrief {
  pdf_id: number;
  markdown_text: string | null;
  blocks: OcrBlock[];
}

export interface OcrBlock {
  id: number;
  block_index: number;
  block_label: string;
  block_content: string | null;
  block_bbox: [number, number, number, number];
  block_order: number | null;
  group_id: number | null;
}
