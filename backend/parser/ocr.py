"""OCR for image-based content using pytesseract (Tesseract wrapper)."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import pytesseract
    from PIL import Image
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False
    logger.warning("pytesseract or Pillow not installed — OCR unavailable.")


def ocr_image(image_path: str | Path) -> Optional[str]:
    """Run Tesseract OCR on an image file. Returns extracted text or None."""
    if not _TESSERACT_AVAILABLE:
        logger.warning("OCR skipped: pytesseract/Pillow unavailable.")
        return None

    image_path = Path(image_path)
    if not image_path.exists():
        logger.error(f"Image not found for OCR: {image_path}")
        return None

    try:
        img = Image.open(str(image_path))
        text = pytesseract.image_to_string(img, lang="eng")
        return text.strip() or None
    except Exception as e:
        logger.warning(f"OCR failed for {image_path}: {e}")
        return None


def ocr_images_in_page(page_data) -> None:
    """In-place: run OCR on all images in a PageData object."""
    for img_data in page_data.images:
        if img_data.ocr_text is None:
            img_data.ocr_text = ocr_image(img_data.image_path)
