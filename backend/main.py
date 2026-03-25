"""FastAPI backend for the Exam Translator application.

Endpoints (original):
  POST   /upload                          – Upload PDF, returns job_id
  GET    /jobs/{job_id}                   – Get processing status
  GET    /exams/{job_id}/questions        – Get all questions (JSON)
  GET    /exams/{job_id}/questions/{q_id} – Get single question
  POST   /preload                         – Preload MS-900.pdf from disk
  GET    /translate/{q_num}               – Translate single question
  GET    /exams/{job_id}/raw_questions    – Get raw (English) questions

Endpoints (new DB-backed):
  POST   /exams/{exam_code}/import            – Import PDF to DB
  POST   /exams/{exam_code}/batch-review      – LLM-review batch of questions
  GET    /exams/{exam_code}/review            – List questions pending review
  PATCH  /exams/{exam_code}/questions/{q_id}  – Edit/approve a question
  POST   /exams/{exam_code}/batch-translate   – Translate approved questions
  GET    /exams/{exam_code}/questions         – List questions with translations
  GET    /exams/{exam_code}/stats             – Status counts
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiofiles
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

# ── Load env early ────────────────────────────────────────────────────────────
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

# ── DB ────────────────────────────────────────────────────────────────────────
from .db.database import get_db, init_db
from .db.models import Question as DBQuestion, Translation as DBTranslation, ReviewStatus, TranslationStatus, ExamMetadata, SyllabusTopic

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger("exam_translator")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Exam Translator API",
    description="Microsoft exam PDF → Spanish interactive simulator",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize DB on startup
@app.on_event("startup")
def startup_event():
    init_db()
    logger.info("Database initialized")


# ── In-memory job store (for legacy upload endpoints) ────────────────────────
class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    error = "error"


class Job(BaseModel):
    job_id: str
    filename: str
    status: JobStatus = JobStatus.queued
    total_questions: int = 0
    processed_questions: int = 0
    error_message: Optional[str] = None


_jobs: Dict[str, Job] = {}
_questions: Dict[str, List[Dict[str, Any]]] = {}

UPLOAD_DIR = Path(tempfile.mkdtemp(prefix="exam_uploads_"))
logger.info(f"Upload dir: {UPLOAD_DIR}")

PDF_BASE_DIR = Path("/home/gabrielguerrero/.openclaw/workspace")


def _get_translator(exam_code: str, db: Session):
    """Build an LLMTranslator with exam context from DB metadata."""
    from .translator.llm_translator import LLMTranslator
    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    if meta:
        return LLMTranslator(
            exam_name=meta.exam_name or "",
            vendor=meta.vendor or "",
            domain=meta.domain or "",
        )
    return LLMTranslator()


# ── Pydantic schemas for new endpoints ───────────────────────────────────────

class QuestionPatch(BaseModel):
    english_stem: Optional[str] = None
    english_options: Optional[List[Dict[str, Any]]] = None
    correct_answer: Optional[str] = None
    correct_answers: Optional[List[str]] = None
    review_status: Optional[str] = None
    review_notes: Optional[List[str]] = None
    question_type: Optional[str] = None
    # Translation fields
    spanish_stem: Optional[str] = None
    spanish_options: Optional[List[Dict[str, Any]]] = None
    spanish_explanation: Optional[str] = None
    english_explanation: Optional[str] = None


class ImportResult(BaseModel):
    imported: int
    updated: int
    exam_code: str
    message: str


class ExamMetadataUpdate(BaseModel):
    exam_name: Optional[str] = None
    vendor: Optional[str] = None
    domain: Optional[str] = None
    version: Optional[str] = None


class BatchProgress(BaseModel):
    processed: int
    total: int
    errors: int = 0


# ── Helper: find PDF ─────────────────────────────────────────────────────────

def _find_pdf(exam_code: str) -> Optional[Path]:
    candidates = [
        PDF_BASE_DIR / f"{exam_code}.pdf",
        PDF_BASE_DIR / f"{exam_code.lower()}.pdf",
        PDF_BASE_DIR / f"{exam_code.upper()}.pdf",
    ]
    return next((p for p in candidates if p.exists()), None)


# ── Background processing (legacy) ───────────────────────────────────────────

def _process_pdf(job_id: str, pdf_path: Path) -> None:
    job = _jobs[job_id]
    job.status = JobStatus.processing
    try:
        from .parser.pdf_extractor import PDFExtractor
        from .parser.question_splitter import QuestionSplitter
        from .parser.question_classifier import QuestionClassifier
        from .translator.llm_translator import LLMTranslator

        extractor = PDFExtractor()
        splitter = QuestionSplitter()
        classifier = QuestionClassifier()
        translator = LLMTranslator()

        pages = extractor.extract(pdf_path)
        raw_qs = splitter.split(pages)
        job.total_questions = len(raw_qs)

        result_questions: List[Dict[str, Any]] = []
        for raw_q in raw_qs:
            q_type = classifier.classify(raw_q)
            translated = translator.translate(raw_q)
            result_questions.append(translated.model_dump())
            job.processed_questions += 1

        _questions[job_id] = result_questions
        job.status = JobStatus.done
        logger.info(f"Job {job_id} complete: {len(result_questions)} questions")
    except Exception as e:
        logger.exception(f"Job {job_id} failed: {e}")
        job.status = JobStatus.error
        job.error_message = str(e)


async def _process_pdf_async(job_id: str, pdf_path: Path) -> None:
    await asyncio.to_thread(_process_pdf, job_id, pdf_path)


# ═══════════════════════════════════════════════════════════════════════════════
# NEW DB-BACKED ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/exams/{exam_code}/metadata")
def get_exam_metadata(exam_code: str, db: Session = Depends(get_db)):
    """Get metadata for an exam."""
    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    if not meta:
        return {"exam_code": exam_code, "exam_name": None, "vendor": None, "domain": None, "version": None}
    return {
        "exam_code": meta.exam_code,
        "exam_name": meta.exam_name,
        "vendor": meta.vendor,
        "domain": meta.domain,
        "version": meta.version,
    }


@app.patch("/exams/{exam_code}/metadata")
def update_exam_metadata(exam_code: str, data: ExamMetadataUpdate, db: Session = Depends(get_db)):
    """Create or update metadata for an exam."""
    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    if not meta:
        meta = ExamMetadata(exam_code=exam_code)
        db.add(meta)
    if data.exam_name is not None:
        meta.exam_name = data.exam_name
    if data.vendor is not None:
        meta.vendor = data.vendor
    if data.domain is not None:
        meta.domain = data.domain
    if data.version is not None:
        meta.version = data.version
    db.commit()
    return {"exam_code": exam_code, "exam_name": meta.exam_name, "vendor": meta.vendor, "domain": meta.domain, "version": meta.version}


# ── Syllabus endpoints ────────────────────────────────────────────────────────

@app.post("/exams/{exam_code}/syllabus/research")
def research_syllabus(exam_code: str, db: Session = Depends(get_db)):
    """Ask LLM to research official syllabus topics for this exam. Replaces existing draft topics."""
    from .translator.syllabus_researcher import SyllabusResearcher

    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    if not meta:
        raise HTTPException(status_code=404, detail="Exam metadata not found. Set vendor/name first.")

    researcher = SyllabusResearcher(
        exam_name=meta.exam_name or "",
        vendor=meta.vendor or "",
        domain=meta.domain or "",
    )

    topics = researcher.research_syllabus()
    if not topics:
        raise HTTPException(status_code=500, detail="LLM returned no topics")

    # Delete existing unconfirmed topics
    db.query(SyllabusTopic).filter(
        SyllabusTopic.exam_code == exam_code,
        SyllabusTopic.confirmed == 0,
    ).delete()

    saved = []
    for i, t in enumerate(topics):
        topic = SyllabusTopic(
            exam_code=exam_code,
            topic_key=t.get("topic_key", f"topic-{i+1}"),
            topic_name=t.get("topic_name", ""),
            description=t.get("description", ""),
            weight_pct=t.get("weight_pct", 0),
            order=t.get("order", i + 1),
            source="llm",
            confirmed=0,
        )
        db.add(topic)
        saved.append(t)

    db.commit()
    return {"exam_code": exam_code, "topics_generated": len(saved), "topics": saved}


@app.get("/exams/{exam_code}/syllabus")
def get_syllabus(exam_code: str, db: Session = Depends(get_db)):
    """Get current syllabus topics with question coverage stats."""
    topics = db.query(SyllabusTopic).filter(
        SyllabusTopic.exam_code == exam_code
    ).order_by(SyllabusTopic.order).all()

    result = []
    for t in topics:
        mapped = db.query(DBQuestion).filter(
            DBQuestion.exam_code == exam_code,
            DBQuestion.syllabus_topic_id == t.id,
        ).count()
        result.append({
            "id": t.id,
            "topic_key": t.topic_key,
            "topic_name": t.topic_name,
            "description": t.description,
            "weight_pct": t.weight_pct,
            "order": t.order,
            "confirmed": bool(t.confirmed),
            "source": t.source,
            "questions_mapped": mapped,
        })

    total_questions = db.query(DBQuestion).filter(DBQuestion.exam_code == exam_code).count()
    unmapped = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.syllabus_topic_id == None,
    ).count()

    return {
        "exam_code": exam_code,
        "topics": result,
        "total_questions": total_questions,
        "mapped_questions": total_questions - unmapped,
        "unmapped_questions": unmapped,
    }


@app.patch("/exams/{exam_code}/syllabus/{topic_id}")
def update_syllabus_topic(exam_code: str, topic_id: int, data: dict, db: Session = Depends(get_db)):
    """Edit or confirm a syllabus topic."""
    topic = db.query(SyllabusTopic).filter(
        SyllabusTopic.id == topic_id,
        SyllabusTopic.exam_code == exam_code,
    ).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found")
    for field in ["topic_name", "description", "weight_pct", "order"]:
        if field in data:
            setattr(topic, field, data[field])
    if data.get("confirmed") is not None:
        topic.confirmed = 1 if data["confirmed"] else 0
    db.commit()
    return {"id": topic.id, "topic_key": topic.topic_key, "confirmed": bool(topic.confirmed)}


@app.post("/exams/{exam_code}/syllabus/confirm-all")
def confirm_all_topics(exam_code: str, db: Session = Depends(get_db)):
    """Mark all topics as confirmed."""
    updated = db.query(SyllabusTopic).filter(SyllabusTopic.exam_code == exam_code).update({"confirmed": 1})
    db.commit()
    return {"confirmed": updated}


@app.post("/exams/{exam_code}/validate-questions")
def validate_questions(
    exam_code: str,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    revalidate: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Use LLM to validate questions against the official syllabus and exam knowledge."""
    from .translator.question_validator import QuestionValidator
    from datetime import datetime as dt

    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    if not meta:
        raise HTTPException(status_code=400, detail="Exam metadata not found.")

    # Build topic map
    topics = db.query(SyllabusTopic).filter(SyllabusTopic.exam_code == exam_code).all()
    if not topics:
        raise HTTPException(status_code=400, detail="No syllabus topics. Run /syllabus/research first.")
    topics_map = {t.id: {"topic_name": t.topic_name, "description": t.description} for t in topics}

    # Get questions to validate (only mapped ones)
    query = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.syllabus_topic_id != None,
    )
    if not revalidate:
        query = query.filter(DBQuestion.validation_status == "pending")

    total = query.count()
    questions = query.order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    validator = QuestionValidator(
        exam_name=meta.exam_name or "",
        vendor=meta.vendor or "",
        domain=meta.domain or "",
    )

    questions_data = [{
        "id": q.id,
        "question_number": q.question_number,
        "english_stem": q.english_stem or q.raw_text,
        "english_options": q.english_options or [],
        "correct_answer": q.correct_answer,
        "correct_answers": q.correct_answers or [],
        "syllabus_topic_id": q.syllabus_topic_id,
    } for q in questions]

    results = validator.batch_validate(questions_data, topics_map)

    valid = needs_review = rejected = 0
    for r in results:
        q = db.query(DBQuestion).filter(DBQuestion.id == r["question_id"]).first()
        if q:
            q.validation_status = r["verdict"]
            q.validation_notes = r["notes"]
            q.validated_at = dt.utcnow()
            # If LLM suggests a different correct answer, add to review_notes
            if r.get("suggested_correct_answer") and r["suggested_correct_answer"] != q.correct_answer:
                notes = q.review_notes or []
                notes.append(f"⚠️ LLM suggests correct answer may be {r['suggested_correct_answer']} (currently {q.correct_answer})")
                q.review_notes = notes
                q.review_status = ReviewStatus.pending  # flag for human review
            db.add(q)
            if r["verdict"] == "valid": valid += 1
            elif r["verdict"] == "rejected": rejected += 1
            else: needs_review += 1

    db.commit()
    return {
        "processed": len(results),
        "total_pending": total,
        "valid": valid,
        "needs_review": needs_review,
        "rejected": rejected,
        "remaining": max(0, total - len(results)),
    }


@app.get("/exams/{exam_code}/validation-stats")
def get_validation_stats(exam_code: str, db: Session = Depends(get_db)):
    """Get validation status counts."""
    from sqlalchemy import func
    rows = db.query(
        DBQuestion.validation_status,
        func.count(DBQuestion.id).label("count")
    ).filter(DBQuestion.exam_code == exam_code).group_by(DBQuestion.validation_status).all()

    stats = {"pending": 0, "valid": 0, "needs_review": 0, "rejected": 0}
    for row in rows:
        stats[row.validation_status or "pending"] = row.count

    total = sum(stats.values())
    return {
        "exam_code": exam_code,
        "total": total,
        **stats,
        "validated_pct": round((stats["valid"] + stats["needs_review"] + stats["rejected"]) / max(total, 1) * 100),
        "valid_pct": round(stats["valid"] / max(total, 1) * 100),
    }


@app.post("/exams/{exam_code}/syllabus/map-questions")
def map_questions_to_topics(
    exam_code: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Use LLM to map questions to syllabus topics."""
    from .translator.syllabus_researcher import SyllabusResearcher

    topics = db.query(SyllabusTopic).filter(SyllabusTopic.exam_code == exam_code).all()
    if not topics:
        raise HTTPException(status_code=400, detail="No syllabus topics found. Run /syllabus/research first.")

    topics_data = [{"topic_key": t.topic_key, "topic_name": t.topic_name, "description": t.description} for t in topics]
    topic_map = {t.topic_key: t.id for t in topics}

    meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
    researcher = SyllabusResearcher(
        exam_name=meta.exam_name if meta else "",
        vendor=meta.vendor if meta else "",
        domain=meta.domain if meta else "",
    )

    questions = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.syllabus_topic_id == None,
    ).order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    total = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.syllabus_topic_id == None,
    ).count()

    questions_data = [
        {"id": q.id, "question_number": q.question_number,
         "english_stem": q.english_stem or q.raw_text,
         "english_options": q.english_options or []}
        for q in questions
    ]

    mappings = researcher.batch_map_questions(questions_data, topics_data)

    mapped = 0
    errors = 0
    for m in mappings:
        if m.get("topic_key") and m["topic_key"] in topic_map:
            q = db.query(DBQuestion).filter(DBQuestion.id == m["question_id"]).first()
            if q:
                q.syllabus_topic_id = topic_map[m["topic_key"]]
                db.add(q)
                mapped += 1
        else:
            errors += 1

    db.commit()
    return {
        "processed": len(mappings),
        "mapped": mapped,
        "errors": errors,
        "total_unmapped_remaining": total - mapped,
    }


@app.post("/exams/{exam_code}/import", response_model=ImportResult)
def import_exam(exam_code: str, db: Session = Depends(get_db)):
    """Parse PDF and save questions to DB. Idempotent: updates existing records."""
    pdf_path = _find_pdf(exam_code)
    if not pdf_path:
        raise HTTPException(status_code=404, detail=f"PDF not found: {exam_code}.pdf in {PDF_BASE_DIR}")

    from .parser.pdf_extractor import PDFExtractor
    from .parser.question_splitter import QuestionSplitter
    from .parser.question_classifier import QuestionClassifier

    pages = PDFExtractor().extract(pdf_path)
    raw_qs = QuestionSplitter().split(pages)
    clf = QuestionClassifier()

    imported = 0
    updated = 0

    for raw_q in raw_qs:
        q_type = clf.classify(raw_q)

        existing = db.query(DBQuestion).filter(
            DBQuestion.exam_code == exam_code,
            DBQuestion.question_number == raw_q.question_number,
        ).first()

        if existing:
            existing.raw_text = raw_q.raw_text
            existing.question_type = q_type.value
            updated += 1
        else:
            db_q = DBQuestion(
                exam_code=exam_code,
                question_number=raw_q.question_number,
                question_type=q_type.value,
                raw_text=raw_q.raw_text,
                review_status=ReviewStatus.pending,
            )
            db.add(db_q)
            imported += 1

    db.commit()
    logger.info(f"Import {exam_code}: {imported} new, {updated} updated")
    return ImportResult(
        imported=imported,
        updated=updated,
        exam_code=exam_code,
        message=f"Imported {imported} new questions, updated {updated} existing.",
    )


@app.post("/exams/{exam_code}/batch-review", response_model=BatchProgress)
def batch_review(
    exam_code: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Send a batch of pending questions to LLM for English review/cleanup."""
    translator = _get_translator(exam_code, db)
    total = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.pending,
    ).count()

    questions = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.pending,
    ).order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    processed = 0
    errors = 0

    from .parser.explicit_parser import try_parse_explicit

    for q in questions:
        try:
            # Try fast regex parse first (no LLM cost)
            result = try_parse_explicit(q.raw_text)
            if result is None:
                # Fall back to LLM review
                result = translator.review_only(q.raw_text, q.question_number)

            q.english_stem = result.get("stem", q.raw_text)
            q.english_options = result.get("options", [])
            q.correct_answer = result.get("correct_answer")
            q.correct_answers = result.get("correct_answers", [])
            q.review_notes = result.get("review_notes", [])
            if result.get("has_issues"):
                pass  # leave pending for human review
            else:
                q.review_status = ReviewStatus.approved
            db.add(q)
            processed += 1
        except Exception as e:
            logger.error(f"Review failed Q{q.question_number}: {e}")
            q.review_notes = [f"Review error: {str(e)}"]
            errors += 1
            db.add(q)

    db.commit()
    return BatchProgress(processed=processed, total=total, errors=errors)


@app.get("/exams/{exam_code}/review")
def get_review_questions(
    exam_code: str,
    status: Optional[str] = None,
    question_number: Optional[int] = None,
    question_type: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List questions pending human review (with LLM notes)."""
    query = db.query(DBQuestion).filter(DBQuestion.exam_code == exam_code)

    if question_number:
        # Direct lookup — ignore status filter, return just that question
        query = query.filter(DBQuestion.question_number == question_number)
    elif status:
        try:
            rs = ReviewStatus(status)
            query = query.filter(DBQuestion.review_status == rs)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    else:
        query = query.filter(DBQuestion.review_status.in_([ReviewStatus.pending, ReviewStatus.edited]))

    if question_type:
        query = query.filter(DBQuestion.question_type == question_type)

    total = query.count()
    questions = query.order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    return {
        "exam_code": exam_code,
        "total": total,
        "offset": offset,
        "limit": limit,
        "questions": [
            {
                "id": q.id,
                "question_number": q.question_number,
                "question_type": q.question_type,
                "review_status": q.review_status,
                "english_stem": q.english_stem,
                "english_options": q.english_options,
                "correct_answer": q.correct_answer,
                "correct_answers": q.correct_answers,
                "review_notes": q.review_notes or [],
                "raw_text": q.raw_text,
                "validation_status": q.validation_status,
                "validation_notes": q.validation_notes or [],
                "translation": {
                    "english_explanation": q.translation.english_explanation if q.translation else None,
                    "spanish_explanation": q.translation.spanish_explanation if q.translation else None,
                    "spanish_stem": q.translation.spanish_stem if q.translation else None,
                } if q.translation else None,
            }
            for q in questions
        ],
    }


@app.patch("/exams/{exam_code}/questions/{q_id}")
def patch_question(
    exam_code: str,
    q_id: int,
    patch: QuestionPatch,
    db: Session = Depends(get_db),
):
    """Edit or approve a question."""
    q = db.query(DBQuestion).filter(
        DBQuestion.id == q_id,
        DBQuestion.exam_code == exam_code,
    ).first()

    if not q:
        raise HTTPException(status_code=404, detail=f"Question {q_id} not found")

    updated_fields = []
    if patch.question_type is not None:
        valid_types = {"multiple_choice", "multiple_select", "drag_and_drop", "hotspot", "dropdown"}
        if patch.question_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid question_type: {patch.question_type}. Valid: {sorted(valid_types)}")
        q.question_type = patch.question_type
        updated_fields.append("question_type")
    if patch.english_stem is not None:
        q.english_stem = patch.english_stem
        updated_fields.append("english_stem")
    if patch.english_options is not None:
        q.english_options = patch.english_options
        updated_fields.append("english_options")
    if patch.correct_answer is not None:
        q.correct_answer = patch.correct_answer
        updated_fields.append("correct_answer")
    if patch.correct_answers is not None:
        q.correct_answers = patch.correct_answers
        updated_fields.append("correct_answers")
    if patch.review_notes is not None:
        q.review_notes = patch.review_notes
        updated_fields.append("review_notes")

    # Translation patch — update or create the translation record
    translation_updates = {k: v for k, v in {
        "spanish_stem": patch.spanish_stem,
        "spanish_options": patch.spanish_options,
        "spanish_explanation": patch.spanish_explanation,
        "english_explanation": patch.english_explanation,
    }.items() if v is not None}

    if translation_updates:
        translation = db.query(DBTranslation).filter(DBTranslation.question_id == q.id).first()
        if translation:
            for field, value in translation_updates.items():
                setattr(translation, field, value)
            db.add(translation)
        else:
            translation = DBTranslation(
                question_id=q.id,
                exam_code=exam_code,
                translation_status=TranslationStatus.done,
                **translation_updates,
            )
            db.add(translation)
        updated_fields.extend(translation_updates.keys())

    if patch.review_status is not None:
        try:
            q.review_status = ReviewStatus(patch.review_status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid review_status: {patch.review_status}")
    elif updated_fields:
        # Auto-set edited status if fields were changed (but no explicit status given)
        if q.review_status == ReviewStatus.pending:
            q.review_status = ReviewStatus.edited

    from datetime import datetime
    q.updated_at = datetime.utcnow()
    db.add(q)
    db.commit()
    db.refresh(q)

    return {
        "id": q.id,
        "question_number": q.question_number,
        "review_status": q.review_status,
        "updated_fields": updated_fields,
    }


@app.post("/exams/{exam_code}/batch-translate", response_model=BatchProgress)
def batch_translate(
    exam_code: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Translate approved questions to Spanish."""
    translator = _get_translator(exam_code, db)
    total = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.approved,
        ~DBQuestion.id.in_(
            db.query(DBTranslation.question_id).filter(
                DBTranslation.translation_status == TranslationStatus.done
            )
        ),
    ).count()

    questions = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.approved,
        ~DBQuestion.id.in_(
            db.query(DBTranslation.question_id).filter(
                DBTranslation.translation_status == TranslationStatus.done
            )
        ),
    ).order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    processed = 0
    errors = 0

    for q in questions:
        try:
            result = translator.translate_only(
                question_number=q.question_number,
                stem=q.english_stem or q.raw_text,
                options=q.english_options or [],
                correct_answer=q.correct_answer or "",
                correct_answers=q.correct_answers or [],
            )

            existing = db.query(DBTranslation).filter(DBTranslation.question_id == q.id).first()
            if existing:
                existing.spanish_stem = result.get("spanish_stem")
                existing.spanish_options = result.get("spanish_options", [])
                existing.spanish_correct_answers = result.get("spanish_correct_answers") or []
                existing.spanish_explanation = result.get("spanish_explanation")
                existing.english_explanation = result.get("english_explanation")
                existing.model_used = translator.model
                existing.translation_status = TranslationStatus.done
                db.add(existing)
            else:
                translation = DBTranslation(
                    question_id=q.id,
                    spanish_stem=result.get("spanish_stem"),
                    spanish_options=result.get("spanish_options", []),
                    spanish_correct_answers=result.get("spanish_correct_answers") or [],
                    spanish_explanation=result.get("spanish_explanation"),
                    english_explanation=result.get("english_explanation"),
                    model_used=translator.model,
                    translation_status=TranslationStatus.done,
                )
                db.add(translation)

            processed += 1
        except Exception as e:
            logger.error(f"Translation failed Q{q.question_number}: {e}")
            errors += 1

    db.commit()
    return BatchProgress(processed=processed, total=total, errors=errors)


@app.post("/exams/{exam_code}/improve-explanations", response_model=BatchProgress)
def improve_explanations(
    exam_code: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Re-generate explanations for translated questions using LLM."""
    translator = _get_translator(exam_code, db)

    # All questions that have a translation
    translations = (
        db.query(DBTranslation, DBQuestion)
        .join(DBQuestion, DBQuestion.id == DBTranslation.question_id)
        .filter(DBQuestion.exam_code == exam_code)
        .filter(DBTranslation.translation_status == TranslationStatus.done)
        .order_by(DBQuestion.question_number)
        .offset(offset)
        .limit(limit)
        .all()
    )

    total = (
        db.query(DBTranslation)
        .join(DBQuestion, DBQuestion.id == DBTranslation.question_id)
        .filter(DBQuestion.exam_code == exam_code)
        .filter(DBTranslation.translation_status == TranslationStatus.done)
        .count()
    )

    processed = 0
    errors = 0

    for translation, q in translations:
        try:
            result = translator.improve_explanation(
                question_number=q.question_number,
                stem=q.english_stem or q.raw_text,
                options=q.english_options or [],
                correct_answers=q.correct_answers or ([q.correct_answer] if q.correct_answer else []),
                existing_explanation=translation.english_explanation or "",
            )
            translation.english_explanation = result.get("english_explanation", translation.english_explanation)
            translation.spanish_explanation = result.get("spanish_explanation", translation.spanish_explanation)
            db.add(translation)
            processed += 1
        except Exception as e:
            logger.error(f"Improve explanation failed Q{q.question_number}: {e}")
            errors += 1

    db.commit()
    return BatchProgress(processed=processed, total=total, errors=errors)


@app.get("/exams/{exam_code}/questions")
def get_exam_questions(
    exam_code: str,
    translated_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """List questions with translations. Use translated_only=true for simulator."""
    query = db.query(DBQuestion).filter(DBQuestion.exam_code == exam_code)

    if translated_only:
        query = query.join(DBTranslation).filter(
            DBTranslation.translation_status == TranslationStatus.done
        )

    total = query.count()
    questions = query.order_by(DBQuestion.question_number).offset(offset).limit(limit).all()

    result = []
    for q in questions:
        q_data = {
            "id": q.id,
            "question_number": q.question_number,
            "question_type": q.question_type,
            "review_status": q.review_status,
            "english_stem": q.english_stem,
            "english_options": q.english_options,
            "correct_answer": q.correct_answer,
            "correct_answers": q.correct_answers,
            "review_notes": q.review_notes or [],
            "translation": None,
        }
        if q.translation:
            q_data["translation"] = {
                "spanish_stem": q.translation.spanish_stem,
                "spanish_options": q.translation.spanish_options,
                "spanish_correct_answers": q.translation.spanish_correct_answers,
                "spanish_explanation": q.translation.spanish_explanation,
                "english_explanation": q.translation.english_explanation,
                "translation_status": q.translation.translation_status,
                "model_used": q.translation.model_used,
            }
        result.append(q_data)

    return {
        "exam_code": exam_code,
        "total": total,
        "offset": offset,
        "limit": limit,
        "translated_only": translated_only,
        "questions": result,
    }


@app.get("/exams/{exam_code}/export")
def export_questions(
    exam_code: str,
    status: Optional[str] = None,
    question_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Export all filtered questions as JSON — includes LLM notes, english explanation and spanish translation."""
    from fastapi.responses import Response
    import json as _json

    query = (
        db.query(DBQuestion)
        .outerjoin(DBTranslation, DBTranslation.question_id == DBQuestion.id)
        .filter(DBQuestion.exam_code == exam_code)
    )

    if status:
        try:
            rs = ReviewStatus(status)
            query = query.filter(DBQuestion.review_status == rs)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    if question_type:
        query = query.filter(DBQuestion.question_type == question_type)

    questions = query.order_by(DBQuestion.question_number).all()

    result = []
    for q in questions:
        entry = {
            "question_number": q.question_number,
            "question_type": q.question_type,
            "review_status": str(q.review_status.value if hasattr(q.review_status, 'value') else q.review_status),
            "english_stem": q.english_stem,
            "english_options": q.english_options or [],
            "correct_answer": q.correct_answer,
            "correct_answers": q.correct_answers or [],
            "review_notes": q.review_notes or [],
            "translation": None,
        }
        if q.translation:
            entry["translation"] = {
                "spanish_stem": q.translation.spanish_stem,
                "spanish_options": q.translation.spanish_options or [],
                "spanish_correct_answers": q.translation.spanish_correct_answers or [],
                "spanish_explanation": q.translation.spanish_explanation,
                "english_explanation": q.translation.english_explanation,
            }
        result.append(entry)

    # Build filename: e.g. MS-900_pending_multiple_choice.json
    parts = [exam_code]
    if status:
        parts.append(status)
    if question_type:
        parts.append(question_type)
    filename = "_".join(parts) + ".json"

    payload = _json.dumps({
        "exam_code": exam_code,
        "filters": {"status": status, "question_type": question_type},
        "total": len(result),
        "questions": result,
    }, ensure_ascii=False, indent=2)

    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/exams")
def list_exams(db: Session = Depends(get_db)):
    """List all exam codes available in the DB with basic stats."""
    from sqlalchemy import func, distinct
    rows = db.query(
        DBQuestion.exam_code,
        func.count(DBQuestion.id).label("total"),
    ).group_by(DBQuestion.exam_code).order_by(DBQuestion.exam_code).all()

    result = []
    for row in rows:
        translated = db.query(DBTranslation).join(DBQuestion).filter(
            DBQuestion.exam_code == row.exam_code,
            DBTranslation.translation_status == TranslationStatus.done,
        ).count()
        result.append({
            "exam_code": row.exam_code,
            "total": row.total,
            "translated": translated,
        })
    return result


@app.post("/exams/{exam_code}/upload-pdf", response_model=ImportResult)
async def upload_and_import_pdf(
    exam_code: str,
    file: UploadFile = File(...),
    exam_name: Optional[str] = None,
    vendor: Optional[str] = None,
    domain: Optional[str] = None,
    version: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Upload a PDF for an exam code and immediately import questions to DB."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    # Save/update exam metadata if provided
    if any([exam_name, vendor, domain, version]):
        meta = db.query(ExamMetadata).filter(ExamMetadata.exam_code == exam_code).first()
        if not meta:
            meta = ExamMetadata(exam_code=exam_code)
            db.add(meta)
        if exam_name: meta.exam_name = exam_name
        if vendor: meta.vendor = vendor
        if domain: meta.domain = domain
        if version: meta.version = version
        db.commit()

    dest = PDF_BASE_DIR / f"{exam_code}.pdf"
    async with aiofiles.open(dest, "wb") as out:
        content = await file.read()
        await out.write(content)

    # Now run the import
    from .parser.pdf_extractor import PDFExtractor
    from .parser.question_splitter import QuestionSplitter
    from .parser.question_classifier import QuestionClassifier

    pages = PDFExtractor().extract(dest)
    raw_qs = QuestionSplitter().split(pages)
    clf = QuestionClassifier()

    imported = 0
    updated = 0

    for raw_q in raw_qs:
        q_type = clf.classify(raw_q)
        existing = db.query(DBQuestion).filter(
            DBQuestion.exam_code == exam_code,
            DBQuestion.question_number == raw_q.question_number,
        ).first()

        if existing:
            existing.raw_text = raw_q.raw_text
            existing.question_type = q_type.value
            updated += 1
        else:
            db_q = DBQuestion(
                exam_code=exam_code,
                question_number=raw_q.question_number,
                question_type=q_type.value,
                raw_text=raw_q.raw_text,
                review_status=ReviewStatus.pending,
            )
            db.add(db_q)
            imported += 1

    db.commit()
    logger.info(f"Upload+Import {exam_code}: {imported} new, {updated} updated")
    return ImportResult(
        imported=imported,
        updated=updated,
        exam_code=exam_code,
        message=f"PDF guardado e importado: {imported} nuevas preguntas, {updated} actualizadas.",
    )


@app.get("/exams/{exam_code}/stats")
def get_exam_stats(exam_code: str, db: Session = Depends(get_db)):
    """Get counts by review_status and translation_status."""
    total = db.query(DBQuestion).filter(DBQuestion.exam_code == exam_code).count()
    pending = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.pending,
    ).count()
    approved = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.approved,
    ).count()
    edited = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.edited,
    ).count()
    skipped = db.query(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBQuestion.review_status == ReviewStatus.skipped,
    ).count()

    translated = db.query(DBTranslation).join(DBQuestion).filter(
        DBQuestion.exam_code == exam_code,
        DBTranslation.translation_status == TranslationStatus.done,
    ).count()

    return {
        "exam_code": exam_code,
        "total": total,
        "by_review_status": {
            "pending": pending,
            "approved": approved,
            "edited": edited,
            "skipped": skipped,
        },
        "translated": translated,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# LEGACY ENDPOINTS (kept for backward compatibility)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/upload", response_model=Job, status_code=202)
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Upload a Microsoft exam PDF for processing."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    job_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / f"{job_id}.pdf"

    async with aiofiles.open(dest, "wb") as out:
        content = await file.read()
        await out.write(content)

    job = Job(job_id=job_id, filename=file.filename)
    _jobs[job_id] = job
    _questions[job_id] = []

    background_tasks.add_task(_process_pdf_async, job_id, dest)
    logger.info(f"Queued job {job_id} for {file.filename}")
    return job


@app.get("/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.post("/preload", response_model=Job, status_code=202)
async def preload_pdf(background_tasks: BackgroundTasks):
    """Parse the MS-900.pdf already on disk (no upload needed)."""
    candidates = [
        Path(__file__).parent.parent.parent / "MS-900.pdf",
        PDF_BASE_DIR / "MS-900.pdf",
    ]
    pdf_path = next((p for p in candidates if p.exists()), None)
    if not pdf_path:
        raise HTTPException(status_code=404, detail="MS-900.pdf not found on server")

    job_id = str(uuid.uuid4())
    job = Job(job_id=job_id, filename="MS-900.pdf")
    _jobs[job_id] = job
    _questions[job_id] = []

    background_tasks.add_task(_process_pdf_async, job_id, pdf_path)
    logger.info(f"Preload job {job_id} for MS-900.pdf")
    return job


@app.get("/exams/{job_id}/raw_questions")
async def get_raw_questions(job_id: str, limit: int = 50, offset: int = 0):
    """Get raw (English, unparsed) questions for preview — no translation needed."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    pdf_path = None
    if job.filename == "MS-900.pdf":
        pdf_path = PDF_BASE_DIR / "MS-900.pdf"

    if not pdf_path:
        raise HTTPException(status_code=404, detail="PDF not found for preview")

    from .parser.pdf_extractor import PDFExtractor
    from .parser.question_splitter import QuestionSplitter
    from .parser.question_classifier import QuestionClassifier

    pages = PDFExtractor().extract(pdf_path)
    raw_qs = QuestionSplitter().split(pages)
    clf = QuestionClassifier()

    result = []
    for q in raw_qs[offset: offset + limit]:
        q_type = clf.classify(q)
        result.append({
            "question_number": q.question_number,
            "question_type": q_type.value,
            "raw_text": q.raw_text,
            "page_numbers": q.page_numbers,
        })

    return {
        "job_id": job_id,
        "filename": job.filename,
        "total": len(raw_qs),
        "offset": offset,
        "limit": limit,
        "questions": result,
    }


@app.get("/translate/{question_number}")
async def translate_question(question_number: int):
    """Translate a single question by number using LLM."""
    from .parser.pdf_extractor import PDFExtractor
    from .parser.question_splitter import QuestionSplitter
    from .translator.llm_translator import LLMTranslator

    pdf_path = PDF_BASE_DIR / "MS-900.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="MS-900.pdf not found")

    pages = PDFExtractor().extract(pdf_path)
    raw_qs = QuestionSplitter().split(pages)

    target = next((q for q in raw_qs if q.question_number == question_number), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Question {question_number} not found")

    translator = LLMTranslator()
    result = translator.review_and_translate(target.raw_text, question_number)
    result["question_number"] = question_number
    result["raw_text"] = target.raw_text
    return result


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.2.0"}


# ── Static frontend (if built) ────────────────────────────────────────────────
_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
