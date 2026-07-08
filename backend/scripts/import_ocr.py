"""
Import script: ingest a PDF + PaddleOCR JSON into the LBook database.

Usage:
    uv run python scripts/import_ocr.py \
        --pdf "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.pdf" \
        --ocr "d:/我的项目/LBook/dev-data/Oxford Picture Dictionary 3 ed.ocr.json"
"""

import argparse
import json
import os
import shutil
import sys

# Add the backend directory to sys.path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import engine, SessionLocal
from models import PdfDocument, Base
from import_utils import sha256_file, import_ocr_data


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

    # Validate structure
    from import_utils import validate_ocr_json
    valid, err = validate_ocr_json(ocr_data)
    if not valid:
        print(f"ERROR: {err}")
        sys.exit(1)

    num_pages = len(ocr_data["layoutParsingResults"])
    print(f"Found {num_pages} pages in OCR data")

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()

    # Check for existing document with same hash
    existing = session.query(PdfDocument).filter(PdfDocument.file_hash == pdf_hash).first()
    if existing:
        print(f"PDF already imported (id={existing.id}). Skipping.")
        session.close()
        return

    # Import using shared logic
    doc = import_ocr_data(
        session=session,
        pdf_name=pdf_name,
        pdf_path=dest_path,
        pdf_hash=pdf_hash,
        pdf_size=pdf_size,
        ocr_data=ocr_data,
    )

    session.close()
    print(f"Done! Imported {doc.page_count} pages for PDF id={doc.id}")


if __name__ == "__main__":
    main()
