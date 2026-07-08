from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import PdfDocument, OcrPage, OcrBlock
from schemas import PdfDocumentOut, PdfDocumentDetail, OcrPageBrief, OcrPageOut

router = APIRouter(
    prefix="/api/pdfs",
    tags=["pdfs"],
)


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
