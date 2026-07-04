#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <before.json> <after.json>" >&2
  exit 1
fi

before_file="$1"
after_file="$2"

if [[ ! -f "$before_file" ]]; then
  echo "Missing file: $before_file" >&2
  exit 1
fi

if [[ ! -f "$after_file" ]]; then
  echo "Missing file: $after_file" >&2
  exit 1
fi

# Reports without image_src_basis predate AVIF and were measured on webp.
before_basis="$(jq -r '.image_src_basis // "webp"' "$before_file")"
after_basis="$(jq -r '.image_src_basis // "webp"' "$after_file")"
if [[ "$before_basis" != "$after_basis" ]]; then
  echo "WARNING: image byte columns are NOT comparable — before was measured on" >&2
  echo "         '$before_basis' variants, after on '$after_basis' variants." >&2
  echo "         Img Δ below mixes a methodology change with real savings;" >&2
  echo "         re-capture the baseline with the current script to compare." >&2
  echo >&2
fi

echo "+--------+------------+------------+------------+------------+-------------------+-------------------+-----------------+-----------------+"
echo "|  Page  |  HTML Δ B  |  Gzip Δ B  |  Module Δ  |  Asset Δ   |  Direct JS Δ B    |  Deferred Ref Δ   |  Default Img Δ  |  Overlay Img Δ  |"
echo "+--------+------------+------------+------------+------------+-------------------+-------------------+-----------------+-----------------+"

jq -nr \
  --slurpfile before "$before_file" \
  --slurpfile after "$after_file" '
  def to_map: .pages | map({key, value: .}) | from_entries;
  ($before[0] | to_map) as $b
  | ($after[0] | to_map) as $a
  | (($b + $a) | keys_unsorted | unique[]) as $k
  | {
      key: $k,
      html_delta: (($a[$k].html_bytes // 0) - ($b[$k].html_bytes // 0)),
      gzip_delta: (($a[$k].gzip_bytes // 0) - ($b[$k].gzip_bytes // 0)),
      module_delta: (($a[$k].direct_module_count // 0) - ($b[$k].direct_module_count // 0)),
      asset_delta: (($a[$k].direct_asset_count // 0) - ($b[$k].direct_asset_count // 0)),
      direct_js_delta: (($a[$k].direct_asset_bytes // 0) - ($b[$k].direct_asset_bytes // 0)),
      deferred_ref_delta: (($a[$k].deferred_asset_count // 0) - ($b[$k].deferred_asset_count // 0)),
      default_image_delta: (($a[$k].default_image_bytes // 0) - ($b[$k].default_image_bytes // 0)),
      overlay_image_delta: (($a[$k].overlay_image_bytes // 0) - ($b[$k].overlay_image_bytes // 0))
    }
  | [
      .key,
      (.html_delta | tostring),
      (.gzip_delta | tostring),
      (.module_delta | tostring),
      (.asset_delta | tostring),
      (.direct_js_delta | tostring),
      (.deferred_ref_delta | tostring),
      (.default_image_delta | tostring),
      (.overlay_image_delta | tostring)
    ]
  | @tsv
' | while IFS=$'\t' read -r page html_delta gzip_delta module_delta asset_delta direct_js_delta deferred_ref_delta default_image_delta overlay_image_delta; do
  printf "| %-6s | %-10s | %-10s | %-10s | %-10s | %-17s | %-17s | %-15s | %-15s |\n" \
    "$page" "$html_delta" "$gzip_delta" "$module_delta" "$asset_delta" "$direct_js_delta" "$deferred_ref_delta" "$default_image_delta" "$overlay_image_delta"
done

echo "+--------+------------+------------+------------+------------+-------------------+-------------------+-----------------+-----------------+"
