"""Microsoft-specific question classification rules."""
from __future__ import annotations

import re

from ...models.question import QuestionType
from ...parser.question_classifier import QuestionClassifier
from ...parser.question_splitter import RawQuestion
from ..base import BaseProvider


# Additional MS-specific patterns beyond the base classifier
_MS_CASE_STUDY_RE = re.compile(r"case\s+study", re.IGNORECASE)
_MS_EXHIBIT_RE = re.compile(r"refer\s+to\s+the\s+exhibit|see\s+the\s+exhibit", re.IGNORECASE)


class MicrosoftClassifier(BaseProvider):
    """Classifier tailored for Microsoft AZ/MS/SC/DP certification exams."""

    def __init__(self):
        self._base = QuestionClassifier()

    @property
    def name(self) -> str:
        return "microsoft"

    def classify(self, raw_question: RawQuestion) -> QuestionType:
        return self._base.classify(raw_question)

    def preprocess_text(self, text: str) -> str:
        """Remove common Microsoft exam boilerplate."""
        # Remove "Correct Answer:" lines that give away answers in study dumps
        text = re.sub(r"(?m)^Correct\s+Answer\s*:.*$", "", text)
        # Remove "Section:" lines
        text = re.sub(r"(?m)^Section\s*:.*$", "", text)
        # Remove "Explanation" headers (keep the explanation body)
        # Normalize whitespace
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def is_case_study(self, text: str) -> bool:
        return bool(_MS_CASE_STUDY_RE.search(text))

    def has_exhibit(self, text: str) -> bool:
        return bool(_MS_EXHIBIT_RE.search(text))
