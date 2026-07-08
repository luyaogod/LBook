"""
Import script: ingest a PDF + PaddleOCR JSON into the LBook database.

Usage:
    uv run python scripts/import_ocr.py \
        --pdf "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.pdf" \
        --ocr "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.ocr.json"
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone

# Add the backend directory to sys.path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, SessionLocal
from models import PdfDocument, OcrPage, OcrBlock


def sha256_file(path: str) -> str:
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def detect_html(content: str | None) -> int:
    """Return 1 if content looks like HTML, 0 otherwise."""
    if not content:
        return 0
    return 1 if any(tag in content for tag in ["<div", "<img", "<table", "<span"]) else 0


def main():
    parser = argparse.ArgumentParser(description="Import PDF + OCR JSON into LBook")
    parser.add_argument("--pdf", required=True, help="Path to the PDF file")
    parser.add_argument("--ocr", required=True, help="Path to the OCR JSON file")
    parser.add_argument("--db", default=None, help="SQLite path (default: use database.py config)")
    args = parser.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    ocr_path = os.path.abspath(args.ocr)

    if not os.path.exists(pdf_path):
        print(f"ERROR: PDF not found: {pdf_path}")
        sys.exit(1)
    if not os.path.exists(ocr_path):
        print(f"ERROR: OCR JSON not found: {ocr_path}")
        sys.exit(1)

    # Compute hash and check for duplicates
    pdf_hash = sha256_file(pdf_path)
    pdf_name = os.path.basename(pdf_path)
    pdf_size = os.path.getsize(pdf_path)

    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    # Copy PDF to uploads
    dest_name = f"{pdf_hash}_{pdf_name}"
    dest_path = os.path.join(uploads_dir, dest_name)
    if not os.path.exists(dest_path):
        print(f"Copying PDF to {dest_path} ...")
        shutil.copy2(pdf_path, dest_path)
    else:
        print(f"PDF already exists at {dest_path}")

    # Load OCR JSON
    print(f"Loading OCR JSON ({ocr_path}) ...")
    with open(ocr_path, "r", encoding="utf-8") as f:
        ocr_data = json.load(f)

    data_info = ocr_data.get("dataInfo", {})
    layout_results = ocr_data.get("layoutParsingResults", [])
    num_pages = len(layout_results)
    print(f"Found {num_pages} pages in OCR data")

    # Create tables if they don't exist
    from models import Base
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()

    # Check for existing document with same hash
    existing = session.query(PdfDocument).filter(PdfDocument.file_hash == pdf_hash).first()
    if existing:
        print(f"PDF already imported (id={existing.id}). Skipping.")
        session.close()
        return

    # Insert PdfDocument
    doc = PdfDocument(
        file_name=pdf_name,
        file_path=dest_path,
        file_hash=pdf_hash,
        page_count=num_pages,
        file_size=pdf_size,
        data_info=json.dumps(data_info, ensure_ascii=False),
        status="completed",
    )
    session.add(doc)
    session.flush()  # get doc.id

    total_blocks = 0

    for i, page_result in enumerate(layout_results):
        pruned = page_result.get("prunedResult", {})
        md = page_result.get("markdown", {})

        page_num = i + 1
        page_width = pruned.get("width")
        page_height = pruned.get("height")
        model_settings = json.dumps(pruned.get("model_settings", {}), ensure_ascii=False) if pruned.get("model_settings") else None
        markdown_text = md.get("text")
        markdown_images = json.dumps(md.get("images", {}), ensure_ascii=False) if md.get("images") else None
        pruned_result = json.dumps(pruned, ensure_ascii=False)

        ocr_page = OcrPage(
            pdf_id=doc.id,
            page_num=page_num,
            page_width=page_width,
            page_height=page_height,
            model_settings=model_settings,
            markdown_text=markdown_text,
            markdown_images=markdown_images,
            pruned_result=pruned_result,
        )
        session.add(ocr_page)
        session.flush()  # get ocr_page.id

        parsing_list = pruned.get("parsing_res_list", [])
        block_dicts = []
        for idx, block in enumerate(parsing_list):
            bbox = block.get("block_bbox")
            content = block.get("block_content")
            block_dicts.append({
                "page_id": ocr_page.id,
                "block_index": idx,
                "block_label": block.get("block_label", "unknown"),
                "block_content": content,
                "block_bbox": json.dumps(bbox) if bbox else "[]",
                "block_id_external": block.get("block_id"),
                "group_id": block.get("group_id"),
                "block_order": block.get("block_order"),
                "is_html_content": detect_html(content),
                "created_at": datetime.now(timezone.utc),
            })

        if block_dicts:
            session.bulk_insert_mappings(OcrBlock, block_dicts)
            total_blocks += len(block_dicts)

        if (i + 1) % 50 == 0:
            session.commit()
            print(f"  Imported pages 1–{i+1} ({total_blocks} blocks so far) ...")

    session.commit()
    print(f"\nDone! Imported {num_pages} pages, {total_blocks} blocks for PDF id={doc.id}")
    session.close()


if __name__ == "__main__":
    main()
