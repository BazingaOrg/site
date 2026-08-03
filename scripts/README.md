# Scripts Structure

This directory keeps project automation scripts with a consistent layout.

## Layout

- `check/`: validation and smoke-test scripts.
- `perf/`: page-load metric collection and comparison scripts.
- `photos/`: photo metadata maintenance scripts.
  - `sync-from-r2.js`: list `photos/{album}/{file}` in R2 and write CDN URLs into `_data/photos.json`.
- `vendor/`: third-party asset sync scripts.
- `git-hooks/`: local git hook templates and installers.

## Current publishing surface

Browser-based write/upload pages (`/write-note/`, `/write-post/`, `/upload-photo/`) have been removed. Notes and photos are managed outside the public site UI (for example git + R2 tooling).

## Current checks

- `check/check-terminology.sh`
- `check/check-i18n-keys.sh`
- `check/check-language-routes.sh`
- `check/run-all-checks.sh`

## Performance scripts

- `perf/measure-page-load.sh`: build in production mode and collect page-load related metrics from `_site`.
- `perf/compare-page-metrics.sh`: compare two metric snapshots and print byte/count deltas.

### Usage

```bash
# 1) Collect current metrics (and persist snapshot)
bash scripts/perf/measure-page-load.sh docs/perf/latest.json

# 2) Compare snapshots
bash scripts/perf/compare-page-metrics.sh docs/perf/before.json docs/perf/latest.json
```

## Project-level test commands

- `npm test`: default local verification (same as `test:quick`).
- `npm run test:quick`: run `check:all` and a production Jekyll build.
- `npm run test:full`: run `test:quick` plus page-load metric collection.

## Git hooks

- `git-hooks/pre-push`: local pre-push gate that runs `npm run test:quick`.
- `git-hooks/install.sh`: install the pre-push hook into `.git/hooks/pre-push`.

### Usage

```bash
# Install local pre-push hook
npm run hooks:install
```

## Photos from Cloudflare R2

Expected bucket layout:

```text
bazinga-gallery/
  photos/
    黄山/
      DSCF0978.jpg
    tokyo-2024/
      img001.jpg
```

Public base URL: `https://img.bazinga.ink`

### Auth

Put in `.env` (see `.env.example`):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Account API token with **R2 read**)
- optional: `R2_BUCKET`, `PHOTOS_CDN`, `PHOTOS_PREFIX`

Account ID: Cloudflare Dashboard → R2 → overview, or any bucket details page.

### Usage

```bash
# List bucket and rewrite _data/photos.json
npm run photos:sync-from-r2

# Preview without writing
npm run photos:sync-from-r2 -- --dry-run

# Offline: one object key per line (when API token is unavailable)
npm run photos:sync-from-r2 -- --from-list=tmp/r2-keys.txt
```

Re-running keeps existing `meta.caption` / custom `meta.alt` / `meta.location` when the same R2 key is still present.

Without local derivatives, thumbnail/preview/large currently point at the original CDN URL. Templates tolerate missing widths.

### Build derivatives (thumbnail / preview / large)

Requires **write** access to the bucket (API token R2 Edit, or S3 access keys).

```bash
# Process 1 small album (recommended first run)
npm run photos:build-variants-from-r2 -- --album=20240803桌面

# Dry-run: download + sharp only
npm run photos:build-variants-from-r2 -- --dry-run --limit=2

# Limited batch
npm run photos:build-variants-from-r2 -- --limit=20 --concurrency=2
```

Writes WebP under `photos/{album}/variants/{name}-{thumbnail|preview|large}.webp` and updates `_data/photos.json` dimensions/ratio.

## Vendor scripts

- `vendor/sync-open-heart-element.sh`: download `open-heart-element` based on `_data/vendor_versions.json` and write to `assets/vendor/`.

### Usage

```bash
# Sync all vendor assets
npm run vendor:sync

# Sync only open-heart-element
npm run vendor:sync:open-heart
```
