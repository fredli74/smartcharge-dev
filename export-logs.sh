#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${PROJECT_DIR}/logs"
REBUILD_DIR="${LOG_DIR}/rebuild"
ARCHIVE_DIR="${LOG_DIR}/archive"

# Default is yesterday, because cron runs just after midnight.
TS="${1:-$(date -u -d 'yesterday' +%Y%m%d)}"

if [[ ! "$TS" =~ ^20[0-9]{6}$ ]]; then
  echo "Bad date format: $TS. Expected YYYYMMDD."
  exit 1
fi

cd "$PROJECT_DIR"
mkdir -p "$LOG_DIR" "$REBUILD_DIR" "$ARCHIVE_DIR"

DAY_START="${TS:0:4}-${TS:4:2}-${TS:6:2}T00:00:00Z"
DAY_END="$(date -u -d "${DAY_START} +1 day" +%Y-%m-%dT%H:%M:%SZ)"

export_service() {
  local service="$1"
  local out="${LOG_DIR}/${service}-${TS}.log"
  local tmp="${out}.tmp"

  echo "== exporting ${service} ${TS} =="

  : > "$tmp"

  # Raw rebuild snapshots from this UTC day.
  for snapshot in "${REBUILD_DIR}/${service}-${TS}-"*.log; do
    [[ -f "$snapshot" ]] || continue
    cat "$snapshot" >> "$tmp"
  done

  # Raw logs from current container for this UTC day.
  docker compose logs \
    --no-color \
    --timestamps \
    --since "$DAY_START" \
    --until "$DAY_END" \
    "$service" >> "$tmp" 2>/dev/null || true

  mv "$tmp" "$out"

  echo "  → wrote $(basename "$out")"
}

archive_old_months() {
  local service="$1"

  local keep_current
  local keep_previous

  keep_current="$(date -u +%Y%m)"
  keep_previous="$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y%m)"

  find "$LOG_DIR" -maxdepth 1 -type f \
    -name "${service}-20[0-9][0-9][0-9][0-9][0-9][0-9].log" \
    -printf '%f\n' |
  sed -n 's/^.*-\(20[0-9][0-9][0-9][0-9]\)[0-9][0-9]\.log$/\1/p' |
  sort -u |
  while read -r month; do
    [[ "$month" == "$keep_current" ]] && continue
    [[ "$month" == "$keep_previous" ]] && continue

    local archive tmp
    archive="${ARCHIVE_DIR}/${service}-${month:0:4}-${month:4:2}.tar.gz"
    tmp="${archive}.tmp"

    local files=()
    while IFS= read -r file; do
      files+=("$file")
    done < <(
      find "$LOG_DIR" -maxdepth 1 -type f \
        -name "${service}-${month}[0-9][0-9].log" \
        -printf '%f\n' |
      sort
    )

    if (( ${#files[@]} == 0 )); then
      continue
    fi

    echo "  → archiving ${service} ${month:0:4}-${month:4:2}"

    tar -czf "$tmp" -C "$LOG_DIR" "${files[@]}"
    mv "$tmp" "$archive"

    for file in "${files[@]}"; do
      rm -f "$LOG_DIR/$file"
    done
  done
}

export_service server
export_service worker

echo "== cleaning old rebuild snapshots =="
find "$REBUILD_DIR" -type f -name "*.log" -mtime +3 -delete 2>/dev/null || true

echo "== archiving completed old months =="
archive_old_months server
archive_old_months worker

echo "Done."
