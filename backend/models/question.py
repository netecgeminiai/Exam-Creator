"""Pydantic models for each Microsoft exam question type."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class QuestionType(str, Enum):
    multiple_choice = "multiple_choice"
    multiple_select = "multiple_select"
    drag_and_drop = "drag_and_drop"
    hotspot = "hotspot"
    dropdown = "dropdown"
    unknown = "unknown"


class BaseQuestion(BaseModel):
    question_number: int
    question_type: QuestionType
    raw_text: str = Field(description="Original English raw text extracted from PDF")
    page_numbers: List[int] = Field(default_factory=list)
    has_images: bool = False

    # Translated fields (populated after LLM processing)
    translated_text: Optional[str] = None
    translation_status: str = "pending"  # pending | done | error
    translation_error: Optional[str] = None


class AnswerOption(BaseModel):
    key: str          # A, B, C, D …
    text: str         # English
    text_es: Optional[str] = None  # Spanish


class MultipleChoiceQuestion(BaseQuestion):
    question_type: QuestionType = QuestionType.multiple_choice
    question_text: Optional[str] = None
    question_text_es: Optional[str] = None
    options: List[AnswerOption] = Field(default_factory=list)
    correct_answer: Optional[str] = None  # key of correct option
    explanation: Optional[str] = None
    explanation_es: Optional[str] = None


class MultipleSelectQuestion(BaseQuestion):
    question_type: QuestionType = QuestionType.multiple_select
    question_text: Optional[str] = None
    question_text_es: Optional[str] = None
    options: List[AnswerOption] = Field(default_factory=list)
    correct_answers: List[str] = Field(default_factory=list)  # keys
    num_correct: Optional[int] = None
    explanation: Optional[str] = None
    explanation_es: Optional[str] = None


class DragDropItem(BaseModel):
    id: str
    text: str
    text_es: Optional[str] = None


class DragDropTarget(BaseModel):
    id: str
    label: str
    label_es: Optional[str] = None
    correct_item_id: Optional[str] = None


class DragAndDropQuestion(BaseQuestion):
    question_type: QuestionType = QuestionType.drag_and_drop
    scenario_text: Optional[str] = None
    scenario_text_es: Optional[str] = None
    instruction: Optional[str] = None
    instruction_es: Optional[str] = None
    items: List[DragDropItem] = Field(default_factory=list)   # draggable items
    targets: List[DragDropTarget] = Field(default_factory=list)  # drop zones


class HotspotRow(BaseModel):
    statement: str
    statement_es: Optional[str] = None
    correct_answer: Optional[str] = None  # "Yes" | "No"


class HotspotQuestion(BaseQuestion):
    question_type: QuestionType = QuestionType.hotspot
    scenario_text: Optional[str] = None
    scenario_text_es: Optional[str] = None
    rows: List[HotspotRow] = Field(default_factory=list)


class DropdownSegment(BaseModel):
    """Part of a sentence — either plain text or a dropdown placeholder."""
    type: str  # "text" | "dropdown"
    text: Optional[str] = None
    text_es: Optional[str] = None
    dropdown_id: Optional[str] = None  # links to DropdownGroup


class DropdownGroup(BaseModel):
    id: str
    options: List[str] = Field(default_factory=list)
    options_es: Optional[List[str]] = None
    correct_option: Optional[str] = None


class DropdownQuestion(BaseQuestion):
    question_type: QuestionType = QuestionType.dropdown
    segments: List[DropdownSegment] = Field(default_factory=list)
    dropdowns: List[DropdownGroup] = Field(default_factory=list)
    full_sentence_es: Optional[str] = None


# Union type for type narrowing
AnyQuestion = Union[
    MultipleChoiceQuestion,
    MultipleSelectQuestion,
    DragAndDropQuestion,
    HotspotQuestion,
    DropdownQuestion,
    BaseQuestion,
]
