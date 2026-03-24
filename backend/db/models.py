from sqlalchemy import Column, Integer, String, Text, JSON, DateTime, ForeignKey, Enum as SAEnum, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .database import Base


class SyllabusTopic(Base):
    __tablename__ = "syllabus_topics"

    id = Column(Integer, primary_key=True)
    exam_code = Column(String(50), nullable=False, index=True)
    topic_key = Column(String(50))           # e.g. "scrum-roles"
    topic_name = Column(String(200))         # e.g. "Scrum Roles"
    description = Column(Text)              # what this topic covers
    weight_pct = Column(Integer, default=0) # % of exam questions
    order = Column(Integer, default=0)
    source = Column(String(50), default="llm")   # "llm" or "manual"
    confirmed = Column(Integer, default=0)   # 0=pending, 1=confirmed by admin
    created_at = Column(DateTime, default=datetime.utcnow)

    questions = relationship("Question", back_populates="syllabus_topic")


class ExamMetadata(Base):
    __tablename__ = "exam_metadata"

    id = Column(Integer, primary_key=True)
    exam_code = Column(String(50), nullable=False, unique=True, index=True)
    exam_name = Column(String(200))           # e.g. "Scrum Master Certified (SMC)"
    vendor = Column(String(100))              # e.g. "SCRUMstudy", "Microsoft"
    domain = Column(String(100))              # e.g. "Agile/Scrum", "Cloud Computing"
    version = Column(String(50))              # e.g. "V5", "2024"
    language = Column(String(20), default="en")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReviewStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    edited = "edited"
    skipped = "skipped"


class TranslationStatus(str, enum.Enum):
    pending = "pending"
    done = "done"
    approved = "approved"


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True)
    exam_code = Column(String(50), nullable=False, index=True)
    syllabus_topic_id = Column(Integer, ForeignKey("syllabus_topics.id"), nullable=True)
    syllabus_topic = relationship("SyllabusTopic", back_populates="questions")
    question_number = Column(Integer, nullable=False)
    question_type = Column(String(50))
    raw_text = Column(Text)
    english_stem = Column(Text)
    english_options = Column(JSON)       # [{"key":"A","text":"..."}]
    correct_answer = Column(String(20))  # "A" or "ADE"
    correct_answers = Column(JSON)       # ["A","D","E"]
    review_notes = Column(JSON)          # ["nota1", "nota2"]
    review_status = Column(SAEnum(ReviewStatus), default=ReviewStatus.pending)
    # Syllabus validation
    validation_status = Column(String(20), default="pending")  # pending | valid | needs_review | rejected
    validation_notes = Column(JSON)      # LLM reasoning for the verdict
    validated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    translation = relationship("Translation", back_populates="question", uselist=False)


class Translation(Base):
    __tablename__ = "translations"

    id = Column(Integer, primary_key=True)
    question_id = Column(Integer, ForeignKey("questions.id"), unique=True)
    spanish_stem = Column(Text)
    spanish_options = Column(JSON)
    spanish_correct_answers = Column(JSON)   # translated target labels for drag_and_drop
    spanish_explanation = Column(Text)
    english_explanation = Column(Text)
    model_used = Column(String(100))
    translation_status = Column(SAEnum(TranslationStatus), default=TranslationStatus.pending)
    translated_at = Column(DateTime, default=datetime.utcnow)

    question = relationship("Question", back_populates="translation")
