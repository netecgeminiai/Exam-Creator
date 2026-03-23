"""Extract text and images from each page of a PDF using PyMuPDF (fitz)."""
from __future__ import annotations

import io
import logging
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import fitz  # PyMuPDF

logger = logging.getLogger(__name__)


@dataclass
class ImageData:
    page_number: int
    image_index: int
    image_path: str          # path to saved image file
    width: int
    height: int
    ocr_text: Optional[str] = None  # populated later by ocr.py


@dataclass
class PageData:
    page_number: int          # 1-based
    text: str                 # raw text extracted by PyMuPDF
    images: List[ImageData] = field(default_factory=list)


class PDFExtractor:
    """Extract pages (text + images) from a PDF file."""

    def __init__(self, image_output_dir: Optional[str] = None):
        """
        Args:
            image_output_dir: Directory to save extracted images.
                              Defaults to a temp directory per PDF.
        """
        self.image_output_dir = image_output_dir

    def extract(self, pdf_path: str | Path) -> List[PageData]:
        """Extract all pages from *pdf_path*. Returns a list of PageData."""
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        # Determine image output dir
        if self.image_output_dir:
            img_dir = Path(self.image_output_dir)
        else:
            img_dir = Path(tempfile.mkdtemp(prefix="exam_imgs_"))

        img_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Extracting PDF: {pdf_path}  →  images in {img_dir}")

        doc = fitz.open(str(pdf_path))
        pages: List[PageData] = []

        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_number = page_idx + 1  # 1-based

            # ---- Text extraction ----
            text = page.get_text("text")

            # ---- Image extraction ----
            images: List[ImageData] = []
            image_list = page.get_images(full=True)

            for img_idx, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    img_bytes = base_image["image"]
                    img_ext = base_image["ext"]
                    img_filename = f"p{page_number:04d}_img{img_idx:03d}.{img_ext}"
                    img_path = img_dir / img_filename

                    with open(img_path, "wb") as f:
                        f.write(img_bytes)

                    images.append(ImageData(
                        page_number=page_number,
                        image_index=img_idx,
                        image_path=str(img_path),
                        width=base_image.get("width", 0),
                        height=base_image.get("height", 0),
                    ))
                except Exception as e:
                    logger.warning(f"Could not extract image {img_idx} on page {page_number}: {e}")

            pages.append(PageData(
                page_number=page_number,
                text=text,
                images=images,
            ))

        doc.close()
        logger.info(f"Extracted {len(pages)} pages from {pdf_path.name}")
        return pages
