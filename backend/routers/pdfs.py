import json
import os

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import PdfDocument, OcrPage, OcrBlock
from schemas import PdfDocumentOut, PdfDocumentDetail, OcrPageBrief, OcrPageOut
from import_utils import sha256_bytes, validate_ocr_json, import_ocr_data

router = APIRouter(
    prefix="/api/pdfs",
    tags=["pdfs"],
)

MAX_PDF_SIZE = 200 * 1024 * 1024   # 200 MB
MAX_JSON_SIZE = 50 * 1024 * 1024   # 50 MB


@router.get("/", response_model=list[PdfDocumentOut])
def list_pdfs(db: Session = Depends(get_db)):
    return db.query(PdfDocument).order_by(PdfDocument.created_at.desc()).all()


@router.get("/{pdf_id}", response_model=PdfDocumentDetail)
def get_pdf(pdf_id: int, db: Session = Depends(get_db)):
    pdf = db.query(PdfDocument).filter(PdfDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return pdf


@router.get("/{pdf_id}/pages", response_model=list[OcrPageBrief])
def list_pages(pdf_id: int, db: Session = Depends(get_db)):
    pdf = db.query(PdfDocument).filter(PdfDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return (
        db.query(OcrPage)
        .filter(OcrPage.pdf_id == pdf_id)
        .order_by(OcrPage.page_num)
        .all()
    )


@router.get("/{pdf_id}/pages/{page_num}", response_model=OcrPageOut)
def get_page(pdf_id: int, page_num: int, db: Session = Depends(get_db)):
    page = (
        db.query(OcrPage)
        .filter(OcrPage.pdf_id == pdf_id, OcrPage.page_num == page_num)
        .first()
    )
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")

    # Eager-load blocks ordered by block_index
    page.blocks = (
        db.query(OcrBlock)
        .filter(OcrBlock.page_id == page.id)
        .order_by(OcrBlock.block_index)
        .all()
    )
    return page


@router.get("/{pdf_id}/file")
def get_pdf_file(pdf_id: int, db: Session = Depends(get_db)):
    pdf = db.query(PdfDocument).filter(PdfDocument.id == pdf_id).first()
    if not pdf:
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(
        path=pdf.file_path,
        media_type="application/pdf",
        filename=pdf.file_name,
    )


@router.post("/upload", response_model=PdfDocumentOut, status_code=201)
def upload_pdf(
    pdf: UploadFile = File(...),
    ocr_json: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    # ── Validate PDF ──
    if not pdf.filename or not pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    if pdf.content_type and pdf.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    pdf_bytes = pdf.file.read()
    if len(pdf_bytes) > MAX_PDF_SIZE:
        raise HTTPException(status_code=400, detail="PDF file too large (max 200 MB)")

    # ── Validate JSON ──
    if not ocr_json.filename or not ocr_json.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="File must be a JSON file")

    json_bytes = ocr_json.file.read()
    if len(json_bytes) > MAX_JSON_SIZE:
        raise HTTPException(status_code=400, detail="JSON file too large (max 50 MB)")

    try:
        json_str = json_bytes.decode("utf-8")
        ocr_data = json.loads(json_str)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    # ── Validate OCR structure ──
    valid, err_msg = validate_ocr_json(ocr_data)
    if not valid:
        raise HTTPException(status_code=400, detail=f"Not a valid PaddleOCR JSON: {err_msg}")

    # ── Duplicate detection ──
    pdf_hash = sha256_bytes(pdf_bytes)
    existing = db.query(PdfDocument).filter(PdfDocument.file_hash == pdf_hash).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"This PDF has already been imported (id={existing.id})",
        )

    # ── Save PDF to uploads ──
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    dest_name = f"{pdf_hash}_{pdf.filename}"
    dest_path = os.path.join(uploads_dir, dest_name)
    with open(dest_path, "wb") as f:
        f.write(pdf_bytes)

    # ── Import into database ──
    doc = import_ocr_data(
        session=db,
        pdf_name=pdf.filename,
        pdf_path=dest_path,
        pdf_hash=pdf_hash,
        pdf_size=len(pdf_bytes),
        ocr_data=ocr_data,
    )

    # Refresh to get created_at and other defaults
    db.refresh(doc)
    return doc
