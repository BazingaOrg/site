#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_PATH="${1:-}"

cd "$ROOT_DIR"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

declare -a tracking_specs=(
  "page-tracking.js|direct|production only"
  "journey-tracking.js|idle-deferred|production default"
  "content-journey-tracking.js|idle-deferred|production default"
  "content-health-scoring.js|idle-deferred|production default"
  "ab-testing.js|idle-deferred|production default"
  "server-tracking.js|idle-deferred|production default"
  "performance-tracking.js|idle-deferred|production default"
  "form-tracking.js|idle-deferred|write-note page only"
  "photo-journey-tracking.js|idle-deferred|photos page only"
)

rows_json="[]"
total_raw_bytes=0
total_gzip_bytes=0

echo "+-----------------------------+---------------+----------------------+----------+----------+-------+"
echo "| Script                      | Load Policy   | Scope                | Raw B    | Gzip B   | Lines |"
echo "+-----------------------------+---------------+----------------------+----------+----------+-------+"

for spec in "${tracking_specs[@]}"; do
  IFS="|" read -r file_name load_policy scope <<<"$spec"
  asset_path="assets/${file_name}"

  if [[ ! -f "$asset_path" ]]; then
    echo "Missing tracking asset: $asset_path" >&2
    exit 1
  fi

  raw_bytes="$(wc -c <"$asset_path" | tr -d ' ')"
  gzip_bytes="$(gzip -c "$asset_path" | wc -c | tr -d ' ')"
  line_count="$(wc -l <"$asset_path" | tr -d ' ')"
  total_raw_bytes=$((total_raw_bytes + raw_bytes))
  total_gzip_bytes=$((total_gzip_bytes + gzip_bytes))

  printf "| %-27s | %-13s | %-20s | %-8s | %-8s | %-5s |\n" \
    "$file_name" "$load_policy" "$scope" "$raw_bytes" "$gzip_bytes" "$line_count"

  row_json="$(jq -n \
    --arg file "$asset_path" \
    --arg load_policy "$load_policy" \
    --arg scope "$scope" \
    --argjson raw_bytes "$raw_bytes" \
    --argjson gzip_bytes "$gzip_bytes" \
    --argjson line_count "$line_count" \
    '{
      file: $file,
      load_policy: $load_policy,
      scope: $scope,
      raw_bytes: $raw_bytes,
      gzip_bytes: $gzip_bytes,
      line_count: $line_count
    }')"

  rows_json="$(jq --argjson row "$row_json" '. + [$row]' <<<"$rows_json")"
done

echo "+-----------------------------+---------------+----------------------+----------+----------+-------+"
printf "| %-27s | %-13s | %-20s | %-8s | %-8s | %-5s |\n" \
  "TOTAL" "-" "-" "$total_raw_bytes" "$total_gzip_bytes" "-"
echo "+-----------------------------+---------------+----------------------+----------+----------+-------+"

report_json="$(jq -n \
  --arg generated_at "$timestamp" \
  --arg source "scripts/perf/audit-tracking-scripts.sh" \
  --argjson total_raw_bytes "$total_raw_bytes" \
  --argjson total_gzip_bytes "$total_gzip_bytes" \
  --argjson scripts "$rows_json" \
  '{
    generated_at: $generated_at,
    source: $source,
    totals: {
      raw_bytes: $total_raw_bytes,
      gzip_bytes: $total_gzip_bytes
    },
    scripts: $scripts
  }')"

echo
echo "$report_json" | jq .

if [[ -n "$OUTPUT_PATH" ]]; then
  mkdir -p "$(dirname "$OUTPUT_PATH")"
  echo "$report_json" | jq . >"$OUTPUT_PATH"
  echo
  echo "Saved report: $OUTPUT_PATH"
fi
