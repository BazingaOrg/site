#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_PATH="${1:-}"

cd "$ROOT_DIR"

JEKYLL_ENV=production bundle exec jekyll build >/tmp/jekyll_perf_build.log

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

declare -a page_specs=(
  "home|/|_site/index.html"
  "notes|/notes/|_site/notes/index.html"
  "photos|/photos/|_site/photos/index.html"
)

rows_json="[]"

sum_photo_variant_bytes() {
  local variant_key="$1"
  local limit="${2:-0}"
  local jq_filter='. | sort_by(.uploaded) | reverse'

  if [[ "$limit" != "0" ]]; then
    jq_filter="${jq_filter} | .[0:${limit}]"
  fi

  local total_bytes=0
  while IFS= read -r asset_path; do
    [[ -z "$asset_path" ]] && continue
    local_asset_file="_site${asset_path}"
    if [[ -f "$local_asset_file" ]]; then
      asset_bytes="$(wc -c <"$local_asset_file" | tr -d ' ')"
      total_bytes=$((total_bytes + asset_bytes))
    fi
  done < <(jq -r "${jq_filter} | .[] | .variants.${variant_key}.src // empty" _data/photos.json)

  echo "$total_bytes"
}

for spec in "${page_specs[@]}"; do
  IFS="|" read -r page_key page_route page_file <<<"$spec"

  if [[ ! -f "$page_file" ]]; then
    echo "Missing page file: $page_file" >&2
    exit 1
  fi

  html_bytes="$(wc -c <"$page_file" | tr -d ' ')"
  gzip_bytes="$(gzip -c "$page_file" | wc -c | tr -d ' ')"
  direct_module_count="$(rg -c '<script type="module" src=' "$page_file" || true)"
  direct_module_count="${direct_module_count:-0}"
  direct_assets="$(rg -o '<script type="module" src="/assets/[^"]+"' "$page_file" | sed -E 's/.*src="([^"]+)"/\1/' || true)"

  direct_asset_count=0
  direct_asset_bytes=0
  if [[ -n "$direct_assets" ]]; then
    while IFS= read -r asset_path; do
      [[ -z "$asset_path" ]] && continue
      local_asset_file="_site${asset_path}"
      if [[ -f "$local_asset_file" ]]; then
        asset_bytes="$(wc -c <"$local_asset_file" | tr -d ' ')"
        direct_asset_bytes=$((direct_asset_bytes + asset_bytes))
      fi
      direct_asset_count=$((direct_asset_count + 1))
    done <<<"$direct_assets"
  fi

  deferred_asset_count="$(rg -o '/assets/[a-z0-9-]+\.js' "$page_file" | sort -u | wc -l | tr -d ' ')"
  font_preconnect_count="$(rg -c 'rel="preconnect".*fonts\.(googleapis|gstatic)\.com' "$page_file" || true)"
  font_preconnect_count="${font_preconnect_count:-0}"
  default_image_bytes=0
  overlay_image_bytes=0
  original_image_bytes=0
  if [[ "$page_key" == "home" ]]; then
    default_image_bytes="$(sum_photo_variant_bytes thumbnail 10)"
  elif [[ "$page_key" == "photos" ]]; then
    default_image_bytes="$(sum_photo_variant_bytes preview)"
    overlay_image_bytes="$(sum_photo_variant_bytes large)"
    original_image_bytes="$(sum_photo_variant_bytes original)"
  fi
  open_heart_version=""
  open_heart_cdn_match="$(rg -o 'open-heart-element@[0-9]+\.[0-9]+\.[0-9]+' "$page_file" | head -n 1 || true)"
  open_heart_local_match="$(rg -o 'open-heart-element-[0-9]+\.[0-9]+\.[0-9]+\.js' "$page_file" | head -n 1 || true)"
  if [[ -n "$open_heart_cdn_match" ]]; then
    open_heart_version="${open_heart_cdn_match##*@}"
  elif [[ -n "$open_heart_local_match" ]]; then
    open_heart_version="${open_heart_local_match#open-heart-element-}"
    open_heart_version="${open_heart_version%.js}"
  fi

  row_json="$(jq -n \
    --arg key "$page_key" \
    --arg route "$page_route" \
    --arg file "$page_file" \
    --argjson html_bytes "$html_bytes" \
    --argjson gzip_bytes "$gzip_bytes" \
    --argjson direct_module_count "$direct_module_count" \
    --argjson direct_asset_count "$direct_asset_count" \
    --argjson direct_asset_bytes "$direct_asset_bytes" \
    --argjson deferred_asset_count "$deferred_asset_count" \
    --argjson font_preconnect_count "$font_preconnect_count" \
    --argjson default_image_bytes "$default_image_bytes" \
    --argjson overlay_image_bytes "$overlay_image_bytes" \
    --argjson original_image_bytes "$original_image_bytes" \
    --arg open_heart_version "$open_heart_version" \
    '{
      key: $key,
      route: $route,
      file: $file,
      html_bytes: $html_bytes,
      gzip_bytes: $gzip_bytes,
      direct_module_count: $direct_module_count,
      direct_asset_count: $direct_asset_count,
      direct_asset_bytes: $direct_asset_bytes,
      deferred_asset_count: $deferred_asset_count,
      font_preconnect_count: $font_preconnect_count,
      default_image_bytes: $default_image_bytes,
      overlay_image_bytes: $overlay_image_bytes,
      original_image_bytes: $original_image_bytes,
      open_heart_version: $open_heart_version
    }')"

  rows_json="$(jq --argjson row "$row_json" '. + [$row]' <<<"$rows_json")"
done

report_json="$(jq -n \
  --arg generated_at "$timestamp" \
  --arg source "JEKYLL_ENV=production bundle exec jekyll build" \
  --argjson pages "$rows_json" \
  '{generated_at: $generated_at, source: $source, pages: $pages}')"

echo "+--------+---------+------------+------------+----------------+-------------------+-----------------+----------------------+-----------------+---------------+------------------+"
echo "|  Page  |  Route  |  HTML B    |  Gzip B    |  Direct Module |  Direct Asset JS  |  Direct JS B    |  Deferred Asset Ref  |  Default Img B  |  Overlay Img B |  Original Img B  |"
echo "+--------+---------+------------+------------+----------------+-------------------+-----------------+----------------------+-----------------+---------------+------------------+"

jq -r '.pages[] | [
  .key,
  .route,
  (.html_bytes|tostring),
  (.gzip_bytes|tostring),
  (.direct_module_count|tostring),
  (.direct_asset_count|tostring),
  (.direct_asset_bytes|tostring),
  (.deferred_asset_count|tostring),
  (.default_image_bytes|tostring),
  (.overlay_image_bytes|tostring),
  (.original_image_bytes|tostring)
] | @tsv' <<<"$report_json" | while IFS=$'\t' read -r page route html_b gzip_b direct_m direct_a direct_js_b deferred_ref default_img_b overlay_img_b original_img_b; do
  printf "| %-6s | %-7s | %-10s | %-10s | %-14s | %-17s | %-15s | %-20s | %-15s | %-13s | %-16s |\n" \
    "$page" "$route" "$html_b" "$gzip_b" "$direct_m" "$direct_a" "$direct_js_b" "$deferred_ref" "$default_img_b" "$overlay_img_b" "$original_img_b"
done

echo "+--------+---------+------------+------------+----------------+-------------------+-----------------+----------------------+-----------------+---------------+------------------+"
echo
echo "$report_json" | jq .

if [[ -n "$OUTPUT_PATH" ]]; then
  mkdir -p "$(dirname "$OUTPUT_PATH")"
  echo "$report_json" | jq . >"$OUTPUT_PATH"
  echo
  echo "Saved report: $OUTPUT_PATH"
fi
