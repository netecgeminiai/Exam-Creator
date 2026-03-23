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
from .db.models import Question as DBQuestion, Translation as DBTranslation, ReviewStatus, TranslationStatus

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


# ── Pydantic schemas for new endpoints ───────────────────────────────────────

class QuestionPatch(BaseModel):
    english_stem: Optional[str] = None
    english_options: Optional[List[Dict[str, Any]]] = None
    correct_answer: Optional[str] = None
    correct_answers: Optional[List[str]] = None
    review_status: Optional[str] = None
    review_notes: Optional[List[str]] = None
    question_type: Optional[str] = None


class ImportResult(BaseModel):
    imported: int
    updated: int
    exam_code: str
    message: str


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
    from .translator.llm_translator import LLMTranslator

    translator = LLMTranslator()
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

    for q in questions:
        try:
            result = translator.review_only(q.raw_text, q.question_number)
            q.english_stem = result.get("stem", q.raw_text)
            q.english_options = result.get("options", [])
            q.correct_answer = result.get("correct_answer")
            q.correct_answers = result.get("correct_answers", [])
            q.review_notes = result.get("review_notes", [])
            # Keep as pending so admin can review; mark as "has_issues" via notes
            if result.get("has_issues"):
                # Leave pending for human review
                pass
            else:
                # Auto-approve clean questions
                q.review_status = ReviewStatus.approved
            db.add(q)
            processed += 1
        except Exception as e:
            logger.error(f"Review failed Q{q.question_number}: {e}")
            q.review_notes = [f"LLM review error: {str(e)}"]
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
    from .translator.llm_translator import LLMTranslator

    translator = LLMTranslator()
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
    from .translator.llm_translator import LLMTranslator

    translator = LLMTranslator()

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
