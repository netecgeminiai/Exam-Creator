#!/bin/bash
echo "🛑 Deteniendo Exam Translator..."
pkill -f "uvicorn backend.main" && echo "  Backend detenido" || echo "  Backend ya estaba detenido"
pkill -f "vite.*5173" && echo "  Frontend detenido" || echo "  Frontend ya estaba detenido"
echo "✅ Listo"
