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

The only browser-based publishing entry kept in this repo is `/write-note/`.

Photo upload and write-post browser flows remain removed; gallery photos are managed via R2 tooling instead of a public upload page.

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

### Build derivatives for deploy (afilmory-style, recommended)

No R2 **write** access. Downloads originals, writes WebP under
`images/photos/variants/`, and rewrites `_data/photos.json` so list/overlay use
local `/images/photos/variants/...` while `original` stays on the CDN.

**Vercel:** set env vars so the build uses **R2 API (Read)** — public CDN often returns **403** from build IPs:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Account → Workers R2 Storage → **Read**)
- `R2_BUCKET=bazinga-gallery`
- `PHOTOS_CDN=https://img.bazinga.ink`

```bash
# Small sample
npm run photos:build-variants -- --album=20240803桌面

# Limited / full (also runs on Vercel via buildCommand)
npm run photos:build-variants -- --limit=20
npm run photos:build-variants
```

Variant files are gitignored; generate on each deploy (or locally before `jekyll serve`).

### Legacy: upload derivatives back to R2

`npm run photos:build-variants-from-r2` still exists if you prefer storing thumbs on R2
(requires bucket write credentials).

## Vendor scripts

- `vendor/sync-open-heart-element.sh`: download `open-heart-element` based on `_data/vendor_versions.json` and write to `assets/vendor/`.

### Usage

```bash
# Sync all vendor assets
npm run vendor:sync

# Sync only open-heart-element
npm run vendor:sync:open-heart
```
