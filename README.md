# LBook

A PDF OCR viewer that renders PaddleOCR-parsed PDF documents. Browse imported PDFs, view pages with layout block overlays, and read extracted text in a sidebar — with both block-level and full-page Markdown views.

## Architecture

```
┌───────────── Frontend (React 19 + Vite + Tailwind) ─────────────┐
│  HomePage ──→ PdfViewer (pdf.js canvas + OCR overlays)           │
│                ├─ PdfToolbar (zoom, page nav)                    │
│                ├─ BlockOverlayLayer (bounding boxes)             │
│                └─ OcrSidebar (blocks / markdown toggle)          │
└──────────────────────┬───────────────────────────────────────────┘
                       │ REST API (localhost:8000)
┌──────────────────────┴───────────────────────────────────────────┐
│  Backend (FastAPI + SQLAlchemy + SQLite)                         │
│  pdf_documents ──→ ocr_pages ──→ ocr_blocks                     │
└──────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
LBook/
├── backend/                    # Python backend (FastAPI)
│   ├── main.py                 # App entry point, CORS, lifespan
│   ├── database.py             # SQLite engine + session + Base
│   ├── models.py               # ORM models (3 tables)
│   ├── schemas.py              # Pydantic schemas
│   ├── routers/
│   │   ├── hello.py            # Health check endpoint
│   │   └── pdfs.py             # PDF/OCR API endpoints
│   ├── scripts/
│   │   └── import_ocr.py       # CLI script to ingest PDF + OCR JSON
│   └── uploads/                # Uploaded PDF storage (gitignored)
│
├── frontend/                   # React frontend (Vite + TypeScript)
│   └── src/
│       ├── App.tsx             # Root component (home + viewer routing)
│       ├── api/                # API client functions
│       ├── hooks/              # Custom React hooks
│       ├── types/              # TypeScript interfaces
│       └── components/
│           ├── layout/         # AppHeader
│           ├── home/           # HomePage, PdfFileRow, PdfThumbnail
│           ├── viewer/         # PdfViewer, PdfToolbar, overlays
│           └── sidebar/        # OcrSidebar, BlockCard
│
└── dev-data/                   # Reference data (gitignored)
    ├── db_schema.md            # Full planned database schema
    └── *.html                  # UI mockup wireframes
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend framework** | React 19, TypeScript |
| **Build tool** | Vite 8 |
| **Styling** | Tailwind CSS v4, shadcn/ui |
| **PDF rendering** | pdf.js (pdfjs-dist v4) |
| **Markdown** | react-markdown + remark-gfm + remark-math + rehype-katex |
| **Icons** | lucide-react |
| **Backend framework** | FastAPI (Python 3.11) |
| **ORM** | SQLAlchemy 2.0 |
| **Database** | SQLite |
| **Package manager** | uv (Python), npm (JavaScript) |

## Getting Started

### Prerequisites

- **Python** 3.11+
- **Node.js** 18+
- **uv** (Python package manager)

### 1. Backend Setup

```bash
cd backend

# Install dependencies
uv sync

# Start the dev server
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

The API is available at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 2. Import a PDF + OCR Data

```bash
cd backend

uv run python scripts/import_ocr.py \
    --pdf "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.pdf" \
    --ocr "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.ocr.json"
```

The script:
- Computes a SHA-256 hash for deduplication
- Copies the PDF to `backend/uploads/`
- Parses the PaddleOCR JSON and populates all database tables
- Skips if the same file was already imported

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/api/hello` | Hello world |
| `GET` | `/api/pdfs/` | List all PDFs |
| `GET` | `/api/pdfs/{id}` | PDF detail with page list |
| `GET` | `/api/pdfs/{id}/pages` | List pages for a PDF |
| `GET` | `/api/pdfs/{id}/pages/{page_num}` | Single page with OCR blocks |
| `GET` | `/api/pdfs/{id}/file` | Serve the PDF file |

## Database Schema (v1 — Implemented)

Three tables based on the PaddleOCR-VL output format:

### pdf_documents
Stores imported PDF metadata: filename, path, SHA-256 hash, page count, file size, original `dataInfo` JSON.

### ocr_pages
Per-page OCR results: page dimensions, model settings, full-page Markdown text, raw `prunedResult` JSON backup. Unique on `(pdf_id, page_num)`.

### ocr_blocks
Individual layout blocks from each page's `parsing_res_list`: block label (text/image/table/header/footer/…), content, bounding box `[x1,y1,x2,y2]`, reading order. About 8,600 blocks across 294 pages in the Oxford Picture Dictionary.

> See [dev-data/db_schema.md](dev-data/db_schema.md) for the planned full schema (9 tables including audio resources, line-level text, and tagging).

## Frontend Features

### Home Page
- Lists all imported PDFs with first-page thumbnails
- Client-side search by filename
- Paginated results (10 per page)

### PDF Viewer
- **pdf.js canvas rendering** with zoom controls (30%–300%) and fit-width
- **Page navigation**: first/prev/next/last buttons + direct page number input
- **OCR block overlays**: color-coded bounding boxes positioned over the PDF canvas
  - Coordinate mapping between OCR bbox space and PDF page dimensions
  - 18 block label types each with distinct colors (blue=text, green=title, red=image, purple=table, etc.)

### OCR Sidebar (480px)
- **Blocks view**: individual block cards with type badges, content rendered as Markdown
- **Markdown view**: full-page Markdown rendering with GFM tables, math formulas (KaTeX)
- **Copy to clipboard**: all text from blocks or full Markdown
- **Cross-highlighting**: hover a sidebar card ↔ corresponding overlay highlights on the PDF
- Block count + character count footer

## Data Format

The application expects PaddleOCR-VL (PP-StructureV3) output JSON:

```json
{
  "layoutParsingResults": [
    {
      "prunedResult": {
        "width": 1224,
        "height": 1584,
        "model_settings": { ... },
        "parsing_res_list": [
          {
            "block_label": "paragraph_title",
            "block_content": "### Title text",
            "block_bbox": [443, 222, 682, 265],
            "block_id": 0,
            "group_id": 0,
            "block_order": 1
          }
        ]
      },
      "markdown": {
        "text": "Full page markdown...",
        "images": {}
      }
    }
  ],
  "dataInfo": {
    "type": "pdf",
    "numPages": 294,
    "pages": [{ "width": 1224, "height": 1584 }]
  }
}
```

## Roadmap

- [ ] PDF upload via the UI (currently CLI import only)
- [ ] Per-line text extraction (`ocr_block_lines` table)
- [ ] Audio resource linking
- [ ] Custom tagging system
- [ ] Full-text search across OCR content
- [ ] Multi-document management improvements

## License

MIT
