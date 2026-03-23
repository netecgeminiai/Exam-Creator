"""Classify question type from raw text using keyword matching."""
from __future__ import annotations

import re
from typing import Optional

from ..models.question import QuestionType
from .question_splitter import RawQuestion


# Keyword patterns (case-insensitive)
_DRAG_DROP_RE = re.compile(r"drag\s+and\s+drop", re.IGNORECASE)
_HOTSPOT_RE = re.compile(r"hotspot\s+question|select\s+yes\s+if|yes\s*no\s+table", re.IGNORECASE)
_MULTI_SELECT_RE = re.compile(
    r"each\s+correct\s+answer\s+presents\s+part\s+of\s+the\s+solution"
    r"|choose\s+\w*\s*(?:two|three|four|five|2|3|4|5)\b",
    re.IGNORECASE,
)
_DROPDOWN_RE = re.compile(
    r"select\s+the\s+answer\s+that\s+correctly\s+completes\s+the\s+sentence"
    r"|from\s+the\s+drop-?down\s+(?:list|menu)",
    re.IGNORECASE,
)


class QuestionClassifier:
    """Determine the QuestionType for a RawQuestion based on keyword matching."""

    def classify(self, raw_question: RawQuestion) -> QuestionType:
        text = raw_question.raw_text
        return self._classify_text(text)

    def _classify_text(self, text: str) -> QuestionType:
        if _DRAG_DROP_RE.search(text):
            return QuestionType.drag_and_drop
        if _HOTSPOT_RE.search(text):
            return QuestionType.hotspot
        if _MULTI_SELECT_RE.search(text):
            return QuestionType.multiple_select
        if _DROPDOWN_RE.search(text):
            return QuestionType.dropdown
        return QuestionType.multiple_choice
