from datetime import datetime
from typing import Optional, Any

from pydantic import BaseModel, ConfigDict, field_validator


# ── Hello (keep existing) ──

class HelloResponse(BaseModel):
    message: str


class ErrorResponse(BaseModel):
    detail: str


# ── OCR Block ──

class OcrBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    block_index: int
    block_label: str
    block_content: Optional[str] = None
    block_bbox: list[float]
    block_order: Optional[int] = None
    group_id: Optional[int] = None

    @field_validator("block_bbox", mode="before")
    @classmethod
    def parse_bbox(cls, v: Any) -> list[float]:
        if isinstance(v, str):
            import json
            return json.loads(v)
        return v


# ── OCR Page ──

class OcrPageBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    page_num: int
    page_width: Optional[int] = None
    page_height: Optional[int] = None


class OcrPageOut(OcrPageBrief):
    pdf_id: int
    markdown_text: Optional[str] = None
    blocks: list[OcrBlockOut] = []


# ── PDF Document ──

class PdfDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_name: str
    page_count: int
    file_size: int
    status: str
    created_at: datetime


class PdfDocumentDetail(PdfDocumentOut):
    data_info: Optional[str] = None
    pages: list[OcrPageBrief] = []
