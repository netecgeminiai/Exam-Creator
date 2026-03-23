#!/bin/bash
# Start the FastAPI backend
# Run from the exam-translator/ directory

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/../.venv"

if [ ! -d "$VENV" ]; then
  echo "ERROR: venv not found at $VENV"
  echo "Create with: python -m venv $VENV && $VENV/bin/pip install -r requirements.txt"
  exit 1
fi

echo "Starting Exam Translator API on http://localhost:8000"
echo "API docs: http://localhost:8000/docs"
echo ""

cd "$SCRIPT_DIR"
"$VENV/bin/uvicorn" backend.main:app --reload --port 8000
