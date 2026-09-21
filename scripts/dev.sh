#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r api/requirements.txt
fi

export DOWNLOAD_DIR="${DOWNLOAD_DIR:-$ROOT/downloads}"
export CORS_ORIGINS="${CORS_ORIGINS:-*}"
mkdir -p "$DOWNLOAD_DIR"

.venv/bin/uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000 &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

cd "$ROOT/web"
if [[ ! -d node_modules ]]; then
  npm install
fi
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:8000}"
npm run dev -- --hostname 127.0.0.1 --port 3000
