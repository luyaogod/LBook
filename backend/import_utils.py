"""Shared utilities for importing PDF + OCR data."""

import hashlib
import json
import os
import shutil
from datetime import datetime, timezone

from sqlalchemy.orm import Session

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


def sha256_bytes(data: bytes) -> str:
    """Compute SHA-256 hash of bytes."""
    return hashlib.sha256(data).hexdigest()


def detect_html(content: str | None) -> int:
    """Return 1 if content looks like HTML, 0 otherwise."""
    if not content:
        return 0
    return 1 if any(tag in content for tag in ["<div", "<img", "<table", "<span"]) else 0


def normalize_ocr_json(data: list | dict) -> tuple[list[dict], dict]:
    """Normalize PaddleOCR JSON to (page_results, data_info).

    Supports two formats:
    1. Wrapped: {"layoutParsingResults": [...], "dataInfo": {...}}
    2. Array:    [{"prunedResult": {...}, "markdown": {...}}, ...]
    """
    if isinstance(data, list):
        # Array format: each element is a page result
        if len(data) == 0:
            raise ValueError("OCR JSON array is empty")
        # Validate each element has prunedResult
        for i, page in enumerate(data):
            if not isinstance(page, dict):
                raise ValueError(f"Page {i + 1} must be an object")
            if "prunedResult" not in page:
                raise ValueError(f"Page {i + 1} missing required field: prunedResult")
        data_info = {"type": "pdf", "numPages": len(data), "pages": []}
        return data, data_info

    # Wrapped format
    if not isinstance(data, dict):
        raise ValueError("JSON must be an object or array")
    if "layoutParsingResults" not in data:
        raise ValueError("Missing required field: layoutParsingResults")
    if not isinstance(data["layoutParsingResults"], list):
        raise ValueError("layoutParsingResults must be an array")
    if len(data["layoutParsingResults"]) == 0:
        raise ValueError("layoutParsingResults is empty")
    data_info = data.get("dataInfo", {})
    if not isinstance(data_info, dict):
        raise ValueError("dataInfo must be an object")
    return data["layoutParsingResults"], data_info


def validate_ocr_json(data: list | dict) -> tuple[bool, str]:
    """Validate that the JSON matches an expected PaddleOCR format."""
    try:
        normalize_ocr_json(data)
        return True, ""
    except ValueError as e:
        return False, str(e)


def import_ocr_data(
    session: Session,
    pdf_name: str,
    pdf_path: str,
    pdf_hash: str,
    pdf_size: int,
    ocr_data: list | dict,
) -> PdfDocument:
    """Import OCR JSON data into the database. Returns the created PdfDocument."""
    layout_results, data_info = normalize_ocr_json(ocr_data)
    num_pages = len(layout_results)

    doc = PdfDocument(
        file_name=pdf_name,
        file_path=pdf_path,
        file_hash=pdf_hash,
        page_count=num_pages,
        file_size=pdf_size,
        data_info=json.dumps(data_info, ensure_ascii=False),
        status="completed",
    )
    session.add(doc)
    session.flush()

    total_blocks = 0

    for i, page_result in enumerate(layout_results):
        pruned = page_result.get("prunedResult", {})
        md = page_result.get("markdown", {})

        page_num = i + 1
        page_width = pruned.get("width")
        page_height = pruned.get("height")
        model_settings = (
            json.dumps(pruned.get("model_settings", {}), ensure_ascii=False)
            if pruned.get("model_settings")
            else None
        )
        markdown_text = md.get("text")
        markdown_images = (
            json.dumps(md.get("images", {}), ensure_ascii=False)
            if md.get("images")
            else None
        )
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
        session.flush()

        parsing_list = pruned.get("parsing_res_list", [])
        block_dicts = []
        for idx, block in enumerate(parsing_list):
            bbox = block.get("block_bbox")
            content = block.get("block_content")
            block_dicts.append(
                {
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
                }
            )

        if block_dicts:
            session.bulk_insert_mappings(OcrBlock, block_dicts)
            total_blocks += len(block_dicts)

        if (i + 1) % 50 == 0:
            session.commit()

    session.commit()
    return doc
