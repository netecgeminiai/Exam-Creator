#!/bin/bash
# ============================================================
# Migra exam_translator.db local → Turso
# Requiere: turso CLI instalado y autenticado
# ============================================================
set -e

DB_FILE="./exam_translator.db"
TURSO_DB_NAME="exam-translator"

if [ ! -f "$DB_FILE" ]; then
  echo "❌ No se encontró $DB_FILE"
  exit 1
fi

echo "📤 Subiendo $DB_FILE a Turso DB '$TURSO_DB_NAME'..."
turso db shell $TURSO_DB_NAME < <(sqlite3 $DB_FILE .dump)

echo ""
echo "✅ ¡Migración completa!"
echo ""
echo "📌 Guarda estos valores como secrets en GitHub:"
echo ""
echo "TURSO_DATABASE_URL:"
turso db show $TURSO_DB_NAME --url
echo ""
echo "TURSO_AUTH_TOKEN:"
turso db tokens create $TURSO_DB_NAME
