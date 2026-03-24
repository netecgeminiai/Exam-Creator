"""Split extracted page text into individual questions."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List

from .pdf_extractor import PageData

logger = logging.getLogger(__name__)

# Matches headers like:
#   "QUESTION 1\n"  (Microsoft format)
#   "NO.1 "  or "NO. 1 " (Scrum/other format — number inline with text)
QUESTION_HEADER_RE = re.compile(
    r"(?:^|\n)\s*(?:QUESTION\s+(\d+)\s*\n|NO\.\s*(\d+)\s)",
    re.IGNORECASE,
)


@dataclass
class RawQuestion:
    question_number: int
    raw_text: str
    page_numbers: List[int] = field(default_factory=list)
    has_images: bool = False


class QuestionSplitter:
    """Concatenate page text and split on QUESTION N headers."""

    def split(self, pages: List[PageData]) -> List[RawQuestion]:
        """Return a list of RawQuestion from the extracted pages."""

        # Build a flat list of (page_number, text) to keep track of page origins
        chunks: List[tuple[int, str]] = [(p.page_number, p.text) for p in pages]
        pages_with_images: set = {
            p.page_number for p in pages if p.images
        }

        # Find all question boundaries across the full text
        # We store (start_char_offset, question_number, page_number)
        full_text_parts: List[str] = []
        char_to_page: List[int] = []  # maps each char index → page_number

        for page_num, text in chunks:
            for ch in text:
                char_to_page.append(page_num)
            full_text_parts.append(text)

        full_text = "\n".join(full_text_parts)

        # Rebuild char_to_page for the joined text (adds \n between pages)
        char_to_page = []
        for i, (page_num, text) in enumerate(chunks):
            for ch in text:
                char_to_page.append(page_num)
            if i < len(chunks) - 1:
                char_to_page.append(page_num)  # for the joining \n

        matches = list(QUESTION_HEADER_RE.finditer(full_text))
        if not matches:
            logger.warning("No QUESTION headers found in document!")
            return []

        raw_questions: List[RawQuestion] = []

        for i, match in enumerate(matches):
            q_num = int(match.group(1) or match.group(2))
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)

            text_block = full_text[start:end].strip()

            # Determine which pages this question spans
            span_chars = char_to_page[start:end]
            page_nums = sorted(set(span_chars))

            has_imgs = any(p in pages_with_images for p in page_nums)

            raw_questions.append(RawQuestion(
                question_number=q_num,
                raw_text=text_block,
                page_numbers=page_nums,
                has_images=has_imgs,
            ))

        logger.info(f"Split into {len(raw_questions)} questions")
        return raw_questions
