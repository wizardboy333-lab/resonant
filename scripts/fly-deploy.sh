#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${FLY_API_TOKEN:-}" ]]; then
  echo "FLY_API_TOKEN is required; no Fly deployment was started." >&2
  exit 1
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "flyctl (the fly command) is required; install it from https://fly.io/docs/flyctl/install/" >&2
  exit 1
fi

echo "Deploying resonant-api..."
(
  cd "$ROOT/api"
  fly deploy --config fly.toml --remote-only --yes
)

echo "Deploying resonant-web..."
(
  cd "$ROOT/web"
  fly deploy --config fly.toml --remote-only --yes
)

echo "Both Fly apps deployed."
