# Scripts Structure

This directory keeps project automation scripts with a consistent layout.

## Layout

- `check/`: validation and smoke-test scripts.
- `perf/`: page-load metric collection and comparison scripts.
- `photos/`: photo metadata maintenance scripts.
- `vendor/`: third-party asset sync scripts.
- `git-hooks/`: local git hook templates and installers.

## Current publishing surface

The only browser-based publishing entry still kept in this repo is `/write-note/`.

The older `/write-post/` and `/upload-photo/` flows have been removed, so scripts and docs should not assume those pages still exist.

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

## Vendor scripts

- `vendor/sync-open-heart-element.sh`: download `open-heart-element` based on `_data/vendor_versions.json` and write to `assets/vendor/`.

### Usage

```bash
# Sync all vendor assets
npm run vendor:sync

# Sync only open-heart-element
npm run vendor:sync:open-heart
```
