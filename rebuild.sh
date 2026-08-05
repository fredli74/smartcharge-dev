#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${PROJECT_DIR}/logs/rebuild"
TS="$(date -u +%Y%m%d-%H%M%S)"
DAY_START="$(date -u +%Y-%m-%dT00:00:00Z)"

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR"

save_logs() {
  local service="$1"
  local file="${LOG_DIR}/${service}-${TS}.log"
  local tmp="${file}.tmp"

  echo "== exporting today logs for ${service} =="

  if docker compose logs --no-color --timestamps --since "$DAY_START" "$service" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$file"
    echo "  → saved $(basename "$file")"
  else
    rm -f "$tmp"
    echo "  ⚠ could not export logs for ${service}, continuing"
  fi
}

save_logs server
save_logs worker

echo "== git pull =="
git pull --ff-only

echo "== docker compose build =="
docker compose build

echo "== docker compose up -d =="
docker compose up -d --remove-orphans

echo "Done."
