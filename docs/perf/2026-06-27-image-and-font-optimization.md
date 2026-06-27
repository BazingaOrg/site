# Image & font loading optimization — 2026-06-27

Two changes to cut homepage and story weight without touching the design.

## 1. Story images served as webp variants

Story feeds and the story permalink player referenced the **full-resolution
original JPGs** (`story.variants[0]`) even though every photo already has a
generated `-large.webp` variant (2160 px, ~38 KB). The homepage open-stories
ring eagerly loads its cover, so the most recent story pulled a ~2.4 MB JPG on
first paint.

Rewired the cover/player image to the existing `-large.webp` variant in
`feeds/stories.json`, `feeds/stories-travel.json`, and the `story-items` JSON
in `_layouts/story.html`.

| Surface | Before | After |
| --- | --- | --- |
| Homepage story cover (eager) | ~2.4 MB JPG | ~38 KB webp |
| All 16 highlight covers/slides | 50.3 MB | 3.5 MB (**−93%**) |

`og:image` and `page.image` are intentionally left at full resolution: the
former feeds social cards, and the latter is arbitrary hand-authored content
(absolute URLs, mixed-case extensions, photos outside the variant pipeline) so
a `-large.webp` is not guaranteed to exist.

## 2. Self-hosted fonts

Anuphan (site-wide), Readex Pro (story pages) and Cousine (404) were each
loaded via render-blocking `<link>` to `fonts.googleapis.com` plus two
preconnects. Downloaded the latin + latin-ext woff2 subsets to
`assets/fonts/`, declared local `@font-face` rules in `assets/new.scss`, and
replaced the external links with a single first-party font `preload` per
layout.

- Removed 2 preconnects + 3 render-blocking third-party stylesheets and the
  gstatic round-trips.
- `font_preconnect_count` on every page: **2 → 0** (see `docs/perf/latest.json`).
- Home HTML: **−905 B** vs the `before.json` baseline.
- Bonus: no Google font tracking, works offline.

Subset choice: only latin + latin-ext are downloaded, the ranges this site
actually uses. Chinese text falls back to system fonts (these families have no
CJK glyphs); Thai/Vietnamese/Arabic ranges are unused.

## Measurement note

`npm run perf:measure` aborted under `set -euo pipefail` once preconnects hit
zero, because `rg -c` exits non-zero on no matches. Hardened those counts with
`|| true` + a `0` default so the report keeps generating on a clean,
fully-optimized page.
