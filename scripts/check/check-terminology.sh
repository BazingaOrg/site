#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TARGET_FILES=(
  "index.html"
  "index-zh-CN.html"
  "notes.html"
  "stories.html"
  "photos.html"
  "_layouts/default.html"
  "assets/root.js"
  "assets/site.js"
  "_data/i18n_copy.yml"
)

declare -a DISALLOWED=(
  "\\bWrite Note\\b::Use 'Write note' for UI actions."
  "\\bWrite Post\\b::Use 'Write post' for UI actions."
  "\\bAccess Key\\b::Use 'Access key'."
  "\\bAlt Text\\b::Use 'Alt text'."
  "\\bManual publish\\b::Use 'Manual publishing steps'."
  "\\bManual publishing guide\\b::Use 'Manual publishing steps'."
)

has_issues=0

for item in "${DISALLOWED[@]}"; do
  pattern="${item%%::*}"
  message="${item##*::}"

  if rg -n --no-heading "$pattern" "${TARGET_FILES[@]}" >/tmp/term_hits.txt; then
    has_issues=1
    echo "Found disallowed term: '$pattern'"
    echo "Expected: $message"
    cat /tmp/term_hits.txt
    echo
  fi
done

rm -f /tmp/term_hits.txt

if [[ "$has_issues" -eq 1 ]]; then
  echo "Terminology check failed."
  exit 1
fi

echo "Terminology check passed."
