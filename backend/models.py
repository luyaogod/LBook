from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from database import Base


class PdfDocument(Base):
    __tablename__ = "pdf_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_hash = Column(String, unique=True, nullable=False)
    page_count = Column(Integer, default=0)
    file_size = Column(Integer, default=0)
    data_info = Column(Text, nullable=True)  # JSON string
    status = Column(String, default="completed")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    pages = relationship("OcrPage", back_populates="document", cascade="all, delete-orphan")


class OcrPage(Base):
    __tablename__ = "ocr_pages"
    __table_args__ = (
        UniqueConstraint("pdf_id", "page_num", name="uq_pdf_page"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    pdf_id = Column(Integer, ForeignKey("pdf_documents.id", ondelete="CASCADE"), nullable=False)
    page_num = Column(Integer, nullable=False)
    page_width = Column(Integer, nullable=True)
    page_height = Column(Integer, nullable=True)
    model_settings = Column(Text, nullable=True)  # JSON string
    markdown_text = Column(Text, nullable=True)
    markdown_images = Column(Text, nullable=True)  # JSON string
    pruned_result = Column(Text, nullable=True)  # JSON string
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    document = relationship("PdfDocument", back_populates="pages")
    blocks = relationship("OcrBlock", back_populates="page", cascade="all, delete-orphan")


class OcrBlock(Base):
    __tablename__ = "ocr_blocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    page_id = Column(Integer, ForeignKey("ocr_pages.id", ondelete="CASCADE"), nullable=False)
    block_index = Column(Integer, nullable=False)
    block_label = Column(String, nullable=False)
    block_content = Column(Text, nullable=True)
    block_bbox = Column(Text, nullable=False)  # JSON array [x1, y1, x2, y2]
    block_id_external = Column(Integer, nullable=True)
    group_id = Column(Integer, nullable=True)
    block_order = Column(Integer, nullable=True)
    is_html_content = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    page = relationship("OcrPage", back_populates="blocks")
