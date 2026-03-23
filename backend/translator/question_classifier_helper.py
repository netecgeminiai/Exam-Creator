"""Tiny helper to avoid circular imports inside llm_translator."""
from ..models.question import QuestionType
from ..parser.question_classifier import QuestionClassifier
from ..parser.question_splitter import RawQuestion


def infer_type_from_raw(raw_text: str) -> QuestionType:
    dummy = RawQuestion(question_number=0, raw_text=raw_text)
    return QuestionClassifier().classify(dummy)
