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

## 3. On-demand JS module loading

`site.js` is the single module entry on every page and statically imported the
whole homepage toolkit, so every content page downloaded ~58 KB raw (~16 KB
gzip) of JS — much of it homepage-only or out-of-season:

- `home-photo-carousel.js` (7.2 KB) and `bio-presence.js` (3.6 KB) ran their
  guard checks and no-op'd off the homepage, but still downloaded everywhere.
- `weather.js` statically imported all four effect modules (rain/snow/fog/
  lightning, ~13 KB), so a clear sky — the common case — still fetched them.
- Both `sakura-fall.js` (14 KB, day) and `star-field.js` (9.4 KB, night)
  loaded, though only one runs at a time.

Converted these to dynamic `import()`:

- Carousel and bio load only when their elements exist (homepage).
- The day/night background loads only the active one.
- Weather effects load only for the active condition (in `weather.js`).

Approximate raw / gzip saved on first load:

| Page (night, clear sky) | Skipped now | Saved |
| --- | --- | --- |
| Content page (notes/post/photos) | sakura, carousel, bio, all 4 effects | ~37 KB / ~11 KB |
| Homepage | sakura, all 4 effects | ~27 KB / ~10 KB |

Behavior is unchanged: the weather-driven site-wide background still appears,
and effects still mount when their condition is active — verified by forcing
`rain`/`clear` conditions via the `siteWeather` cache.

## Measurement note

`npm run perf:measure` aborted under `set -euo pipefail` once preconnects hit
zero, because `rg -c` exits non-zero on no matches. Hardened those counts with
`|| true` + a `0` default so the report keeps generating on a clean,
fully-optimized page. (Note: this static-HTML report counts direct `<script>`
references, so it does not reflect the dynamic-import savings above, which live
in the module dependency graph.)
