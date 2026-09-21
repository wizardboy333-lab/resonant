#!/usr/bin/env bash
# Cookie-free hosting helper: keep local Resonant API on :8000 and expose it
# via a Cloudflare quick tunnel so Render web can proxy to a residential/box IP
# instead of Render's blocked datacenter API.
#
# Usage (from repo root or anywhere):
#   ./scripts/keep-api-tunnel.sh
#
# Env:
#   DOWNLOAD_DIR   — defaults to <repo>/downloads
#   API_PORT       — defaults to 8000
#   CLOUDFLARED    — path to cloudflared binary (default: /tmp/cloudflared)
#   TUNNEL_LOG     — log file (default: /workspace/cloudflared-api.log)
#   TUNNEL_URL_FILE — where to write the active https URL
#
# After start: set Render resonant-web env API_INTERNAL_URL to the printed
# https://*.trycloudflare.com URL (no trailing slash), then Manual Deploy web.
# Quick-tunnel URLs change every restart — re-run this script and update Render.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-8000}"
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$ROOT/downloads}"
CLOUDFLARED="${CLOUDFLARED:-/tmp/cloudflared}"
TUNNEL_LOG="${TUNNEL_LOG:-/workspace/cloudflared-api.log}"
TUNNEL_URL_FILE="${TUNNEL_URL_FILE:-/workspace/api-tunnel-url.txt}"
CORS_ORIGINS="${CORS_ORIGINS:-*}"

mkdir -p "$DOWNLOAD_DIR"
mkdir -p "$(dirname "$TUNNEL_LOG")"

if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "error: cloudflared not found or not executable at $CLOUDFLARED" >&2
  echo "Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" >&2
  exit 1
fi

ensure_api() {
  if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    echo "API already healthy on :${API_PORT}"
    return 0
  fi
  if [[ ! -d "$ROOT/.venv" ]]; then
    echo "Creating venv and installing API deps..."
    python3 -m venv "$ROOT/.venv"
    "$ROOT/.venv/bin/pip" install -r "$ROOT/api/requirements.txt"
  fi
  echo "Starting API on 127.0.0.1:${API_PORT} (DOWNLOAD_DIR=$DOWNLOAD_DIR)..."
  (
    cd "$ROOT"
    export DOWNLOAD_DIR CORS_ORIGINS
    nohup "$ROOT/.venv/bin/uvicorn" app.main:app --app-dir api \
      --host 127.0.0.1 --port "$API_PORT" \
      >>/workspace/resonant-api.log 2>&1 &
    echo $! >/workspace/resonant-api.pid
  )
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
      echo "API ready."
      return 0
    fi
    sleep 0.5
  done
  echo "error: API did not become healthy on :${API_PORT}" >&2
  exit 1
}

extract_url() {
  # Prefer live log line; fall back to file contents
  local url
  url="$(rg -o 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1 || true)"
  echo "$url"
}

ensure_api

# Stop prior API-only tunnel (do not touch tunnels aimed at other ports)
if pgrep -f "cloudflared tunnel --url http://127.0.0.1:${API_PORT}" >/dev/null 2>&1; then
  echo "Stopping existing API cloudflared tunnel..."
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${API_PORT}" || true
  sleep 1
fi

: >"$TUNNEL_LOG"
echo "Starting Cloudflare quick tunnel → http://127.0.0.1:${API_PORT}"
echo "Log: $TUNNEL_LOG"
nohup "$CLOUDFLARED" tunnel --url "http://127.0.0.1:${API_PORT}" \
  >>"$TUNNEL_LOG" 2>&1 &
echo $! >/workspace/cloudflared-api.pid

URL=""
for i in $(seq 1 40); do
  URL="$(extract_url)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$URL" ]]; then
  echo "error: could not parse trycloudflare URL from $TUNNEL_LOG" >&2
  tail -30 "$TUNNEL_LOG" >&2 || true
  exit 1
fi

printf '%s\n' "$URL" >"$TUNNEL_URL_FILE"

echo
echo "=============================================="
echo " API tunnel URL (no trailing slash):"
echo "   $URL"
echo "=============================================="
echo
echo "Verify:"
echo "  curl -sS $URL/health"
echo "  curl -sS \"$URL/api/meta?url=https://www.youtube.com/watch?v=jNQXAC9IVRw\""
echo
echo "Update Render (cookie-free path):"
echo "  1. Dashboard → resonant-web → Environment"
echo "  2. Set API_INTERNAL_URL=$URL"
echo "  3. Keep NEXT_PUBLIC_API_URL empty"
echo "  4. Save → Manual Deploy (or wait for env restart)"
echo
echo "URL also written to $TUNNEL_URL_FILE"
echo "Quick tunnels change on every restart — re-run this script and update Render."
echo
echo "Tunnel PID $(cat /workspace/cloudflared-api.pid) — leaving it running."
# Keep script exit 0 while tunnel stays up in background
exit 0
