"""Abstract base class for exam providers (Microsoft, CompTIA, etc.)."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from ..models.question import QuestionType
from ..parser.question_splitter import RawQuestion


class BaseProvider(ABC):
    """A provider knows how to classify and post-process questions for a specific exam vendor."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name e.g. 'microsoft'."""
        ...

    @abstractmethod
    def classify(self, raw_question: RawQuestion) -> QuestionType:
        """Return the QuestionType for the given raw question."""
        ...

    def preprocess_text(self, text: str) -> str:
        """Optional: clean / normalize raw text before classification / translation."""
        return text
