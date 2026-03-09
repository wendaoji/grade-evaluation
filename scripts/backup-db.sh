#!/bin/sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${GRADE_EVAL_DB_PATH:-$ROOT_DIR/data/grade-evaluation.db}"
BACKUP_DIR="${1:-$ROOT_DIR/data/backups}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date '+%Y-%m-%dT%H-%M-%S')"
TARGET="$BACKUP_DIR/grade-evaluation-$TIMESTAMP.db"

cp "$DB_PATH" "$TARGET"
echo "$TARGET"
