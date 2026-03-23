# Exam Translator 🧠

Convert Microsoft certification exam PDFs (MS-900, AZ-900, SC-900, DP-900, …)
into an interactive Spanish-language simulator.

## Features

- **PDF parsing** via PyMuPDF — text + image extraction, no OCR needed for text-based PDFs
- **Question type detection**: multiple choice, multiple select, drag & drop, hotspot/Yes-No, dropdown
- **LLM translation** — OpenAI or Anthropic; structured JSON output per question type
- **FastAPI backend** — REST API with background processing
- **React + Vite frontend** — upload PDF, take exam, see score

---

## Quick Start

### 1. Backend

```bash
cd exam-translator

# (optional) create/activate venv
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate

pip install -r requirements.txt

# Configure LLM (pick one)
export OPENAI_API_KEY="sk-..."          # OpenAI
export LLM_MODEL="gpt-4o"

# OR
export ANTHROPIC_API_KEY="sk-ant-..."
export LLM_PROVIDER="anthropic"
export LLM_MODEL="claude-3-5-sonnet-20241022"

# Run
cd backend
uvicorn main:app --reload --port 8000
```

API docs at: http://localhost:8000/docs

### 2. Frontend

```bash
cd exam-translator/frontend
npm install
npm run dev   # http://localhost:5173
```

### 3. Production build (frontend → served by FastAPI)

```bash
cd frontend
npm run build          # outputs to frontend/dist/
cd ../backend
uvicorn main:app --port 8000   # serves API + static frontend
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | `openai` or `anthropic` |
| `LLM_MODEL` | `gpt-4o` | Model name |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_BASE_URL` | — | Custom base URL (Azure, LM Studio, Ollama…) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |

### Using a Local Model (Ollama)

```bash
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
export LLM_MODEL="mistral"
```

---

## Question Types

| Type | Detection keywords |
|---|---|
| `multiple_choice` | default (fallback) |
| `multiple_select` | "Each correct answer presents part of the solution" |
| `drag_and_drop` | "Drag and Drop Question" |
| `hotspot` | "Hotspot Question", "select Yes if…" |
| `dropdown` | "select the answer that correctly completes the sentence" |

---

## Project Structure

```
exam-translator/
  backend/
    main.py                     FastAPI app
    parser/
      pdf_extractor.py          PyMuPDF page extraction
      question_splitter.py      Split pages on QUESTION N headers
      question_classifier.py    Keyword-based type detection
      ocr.py                    Tesseract OCR for image questions
    translator/
      llm_translator.py         LLM translation + structuring
    models/
      question.py               Pydantic models for all question types
    providers/
      base.py                   Abstract BaseProvider
      microsoft/
        classifier.py           MS-specific rules + boilerplate cleanup
  frontend/
    src/
      App.tsx                   Upload UI + polling
      ExamSimulator.tsx         Interactive exam UI
      api.ts                    API client
  requirements.txt
  README.md
```

---

## Running the Parser Standalone

```bash
cd exam-translator
.venv/bin/python - << 'EOF'
from backend.parser.pdf_extractor import PDFExtractor
from backend.parser.question_splitter import QuestionSplitter
from backend.parser.question_classifier import QuestionClassifier

pages = PDFExtractor().extract("../MS-900.pdf")
qs = QuestionSplitter().split(pages)
clf = QuestionClassifier()
for q in qs[:5]:
    print(f"Q{q.question_number:3d} [{clf.classify(q).value:20s}] pages={q.page_numbers}")
EOF
```

---

## Roadmap / TODOs

- [ ] Persist jobs to SQLite / PostgreSQL
- [ ] Redis job queue (Celery or ARQ) for multi-worker scaling
- [ ] Batch LLM calls (reduce API costs)
- [ ] Full drag-and-drop interactive UI
- [ ] Review mode (see all answers at end)
- [ ] Export translated exam to PDF / DOCX
- [ ] Support CompTIA / Cisco PDF formats
