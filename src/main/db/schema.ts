/**
 * Schema v1.
 *
 * Table and column names mirror the legacy SQLAlchemy models one-for-one so the
 * import reconstruction logic carries over unchanged. Three columns are new:
 *
 *   uid           stable identity used in lbook:// URLs; survives re-import.
 *   relative_path path of the .lbook relative to the library dir, so the
 *                 library can be relocated without rewriting every row.
 *   dirty         1 when the working copy differs from the .lbook on disk.
 *
 * Timestamps are ISO 8601 UTC strings.
 */
export const SCHEMA_V1 = `
CREATE TABLE pdf_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT    NOT NULL UNIQUE,
  file_name     TEXT    NOT NULL,
  author        TEXT,
  file_path     TEXT    NOT NULL,
  relative_path TEXT    NOT NULL,
  file_hash     TEXT    NOT NULL UNIQUE,
  page_count    INTEGER NOT NULL DEFAULT 0,
  file_size     INTEGER NOT NULL DEFAULT 0,
  -- Container (.lbook) mtime in ms. Lets a library scan detect an externally
  -- modified package without hashing a 200 MB file on every scan.
  file_mtime    REAL    NOT NULL DEFAULT 0,
  data_info     TEXT,
  cover_path    TEXT,
  status        TEXT    NOT NULL DEFAULT 'completed',
  dirty         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL
);

CREATE TABLE ocr_pages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pdf_id          INTEGER NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
  page_num        INTEGER NOT NULL,
  page_width      INTEGER,
  page_height     INTEGER,
  model_settings  TEXT,
  markdown_text   TEXT,
  markdown_images TEXT,
  pruned_result   TEXT,
  created_at      TEXT    NOT NULL,
  CONSTRAINT uq_pdf_page UNIQUE (pdf_id, page_num)
);

CREATE TABLE ocr_blocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id           INTEGER NOT NULL REFERENCES ocr_pages(id) ON DELETE CASCADE,
  block_index       INTEGER NOT NULL,
  block_label       TEXT    NOT NULL,
  block_content     TEXT,
  block_bbox        TEXT    NOT NULL,
  block_id_external INTEGER,
  group_id          INTEGER,
  block_order       INTEGER,
  is_html_content   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);

CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL
);

CREATE TABLE reading_progress (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pdf_id        INTEGER NOT NULL REFERENCES pdf_documents(id) ON DELETE CASCADE,
  last_page_num INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL,
  CONSTRAINT uq_user_pdf_progress UNIQUE (user_id, pdf_id)
);

CREATE INDEX idx_pdf_id       ON pdf_documents (id);
CREATE INDEX idx_pdf_uid      ON pdf_documents (uid);
CREATE INDEX idx_pages_pdf    ON ocr_pages (pdf_id);
CREATE INDEX idx_page_id      ON ocr_blocks (page_id);
CREATE INDEX idx_block_label  ON ocr_blocks (block_label);
CREATE INDEX idx_block_order  ON ocr_blocks (block_order);
CREATE INDEX idx_progress_pdf ON reading_progress (pdf_id);
`
