FROM python:3.11-slim

# System deps (for pytesseract + pymupdf)
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-spa \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY backend/ ./backend/
COPY .env* ./

# Turso: set DATABASE_URL and TURSO_AUTH_TOKEN as env vars in Azure App Service
# For local dev fallback, SQLite still works:
ENV DATABASE_URL=sqlite:////app/data/exam_translator.db
RUN mkdir -p /app/data

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
