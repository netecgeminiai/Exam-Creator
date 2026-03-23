#!/bin/bash
# Exam Translator - Script de inicio
# Uso: bash start.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HOME/.openclaw/workspace/.venv"

echo "🚀 Iniciando Exam Translator..."

# Backend
echo "▶ Backend (puerto 8000)..."
cd "$SCRIPT_DIR"
nohup "$VENV/bin/uvicorn" backend.main:app --host 0.0.0.0 --port 8000 > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "  PID: $BACKEND_PID"

sleep 3

# Frontend
echo "▶ Frontend (puerto 5173)..."
cd "$SCRIPT_DIR/frontend"
nohup npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "  PID: $FRONTEND_PID"

sleep 3

echo ""
echo "✅ Listo!"
echo "   App:    http://localhost:5173"
echo "   API:    http://localhost:8000/docs"
echo ""
echo "Para detener: bash $SCRIPT_DIR/stop.sh"
