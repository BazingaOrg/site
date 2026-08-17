import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import {
  DEFAULT_BUCKET,
  loadDotEnv,
  mapPool,
  normalizeCdn,
  publicCdnUrl,
  encodeObjectPath,
  repoRoot,
  sortPhotosNewestFirst
} from './lib.mjs'

/**
 * Afilmory-style thumbs (default = site static asset, not R2 write):
 *   download original (CDN/R2 read) → 720w WebP → images/photos/variants/
 *   photos.json thumbnail.src = /images/photos/variants/…-thumb.webp
 *   list/home use thumb; lightbox uses viewer (1920w) then CDN original
 *   Deploy runs encode (missing only) so thumbs/viewers ship inside Jekyll _site
 *
 * Schema: variants = { original, thumbnail, viewer? }.
 *
 * Deploy / full site build (default):
 *   npm run build:site
 *   # → photos:build-variants (encode missing) → vendor → jekyll
 *
 * Local when thumbs already on disk (skip re-download):
 *   npm run photos:build-variants:prebuilt
 *
 * Optional: upload thumbs to R2 CDN (explicit only; needs R2 Write):
 *   npm run photos:build-variants:upload
 */

const THUMB_WIDTH = Number(process.env.PHOTOS_THUMB_WIDTH || 720) || 720
const THUMB_QUALITY = Number(process.env.PHOTOS_THUMB_QUALITY || 78) || 78
const VIEWER_WIDTH = Number(process.env.PHOTOS_VIEWER_WIDTH || 1920) || 1920
const VIEWER_QUALITY = Number(process.env.PHOTOS_VIEWER_QUALITY || 80) || 80
const SITE_ORIGIN = (process.env.PHOTOS_SITE_ORIGIN || 'https://site.bazinga.ink').replace(/\/$/, '')
const ENCODE_VIEWERS = process.env.PHOTOS_ENCODE_VIEWERS !== '0'
const BACKFILL_VIEWERS = process.env.PHOTOS_ENCODE_VIEWERS === 'all'
// Lower effort on CI for speed (Afilmory-style deploy encode); local default still 4.
const THUMB_EFFORT = Number(
  process.env.PHOTOS_THUMB_EFFORT ||
    (process.env.VERCEL === '1' || process.env.CI === 'true' ? 2 : 4)
)
const DEFAULT_CONCURRENCY =
  Number(process.env.PHOTOS_BUILD_CONCURRENCY) ||
  (process.env.VERCEL === '1' || process.env.CI === 'true' ? 8 : 4) ||
  4
const VARIANTS_DIR = path.join(repoRoot, 'images', 'photos', 'variants')
const VARIANTS_URL = '/images/photos/variants'
const SHARP_OPTS = { failOn: 'none', limitInputPixels: false }
const CDN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; site-photos-build/1.0; +https://site.bazinga.ink)',
  Accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
}

function parseArgs(argv) {
  const options = {
    force: false,
    limit: null,
    album: null,
    concurrency: DEFAULT_CONCURRENCY,
    prebuiltOnly:
      process.env.PHOTOS_PREBUILT_ONLY === '1' ||
      process.env.PHOTOS_PREBUILT_ONLY === 'true',
    upload:
      process.env.PHOTOS_UPLOAD_THUMBS === '1' ||
      process.env.PHOTOS_UPLOAD_THUMBS === 'true',
    dryRun: false,
    help: false
  }
  for (const arg of argv) {
    if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--prebuilt-only') options.prebuiltOnly = true
    else if (arg === '--upload') options.upload = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8))
    else if (arg.startsWith('--album=')) options.album = arg.slice(8)
    else if (arg.startsWith('--concurrency=')) {
      options.concurrency = Math.max(1, Number(arg.slice(15)) || 1)
    }
  }
  return options
}

function safeBase(photo) {
  return (
    String(photo.id || 'photo')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120) || 'photo'
  )
}

function thumbName(photo) {
  return `${safeBase(photo)}-thumb.webp`
}

function thumbAbs(photo) {
  return path.join(VARIANTS_DIR, thumbName(photo))
}

function thumbUrl(photo) {
  return `${VARIANTS_URL}/${thumbName(photo)}`
}

/** Remote object key for R2: photos/variants/{safeBase}-thumb.webp */
function thumbKey(photo) {
  return `photos/variants/${thumbName(photo)}`
}

function thumbCdnUrl(photo, cdn) {
  return publicCdnUrl(cdn, thumbKey(photo))
}

function viewerName(photo) {
  return `${safeBase(photo)}-viewer.webp`
}

function viewerAbs(photo) {
  return path.join(VARIANTS_DIR, viewerName(photo))
}

function viewerUrl(photo) {
  return `${VARIANTS_URL}/${viewerName(photo)}`
}

function originalWidth(photo) {
  return Number(photo.variants?.original?.width) || 0
}

function shouldHaveViewer(photo) {
  const width = originalWidth(photo)
  return !width || width > THUMB_WIDTH
}

function encodeViewersEnabled() {
  return ENCODE_VIEWERS
}

function backfillViewersEnabled() {
  return BACKFILL_VIEWERS
}

function readViewerVariant(photo) {
  const existing = photo.variants?.viewer
  if (existsSync(viewerAbs(photo))) {
    return {
      src: existing?.src && String(existing.src).includes('-viewer.webp') ? existing.src : viewerUrl(photo),
      width: existing?.width,
      height: existing?.height,
      type: existing?.type || 'image/webp'
    }
  }
  if (existing?.src && String(existing.src).includes('-viewer.webp')) {
    return {
      src: existing.src,
      width: existing.width,
      height: existing.height,
      type: existing.type || 'image/webp'
    }
  }
  return null
}

async function hydrateVariantFromSite(filename, dest) {
  if (existsSync(dest)) return true
  try {
    const response = await fetch(`${SITE_ORIGIN}/images/photos/variants/${filename}`, {
      headers: { ...CDN_HEADERS, Accept: 'image/webp,*/*' },
      redirect: 'follow'
    })
    if (!response.ok) return false
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 32) return false
    writeFileSync(dest, buffer)
    return true
  } catch {
    return false
  }
}

async function ensureLocalDerivatives(photo) {
  const jobs = []
  if (!existsSync(thumbAbs(photo))) {
    jobs.push(hydrateVariantFromSite(thumbName(photo), thumbAbs(photo)))
  }
  if (encodeViewersEnabled() && shouldHaveViewer(photo) && !existsSync(viewerAbs(photo))) {
    jobs.push(hydrateVariantFromSite(viewerName(photo), viewerAbs(photo)))
  }
  if (jobs.length) await Promise.all(jobs)
}

function needsEncode(photo, { force = false } = {}) {
  if (force) return true
  if (!existsSync(thumbAbs(photo))) return true
  if (backfillViewersEnabled() && shouldHaveViewer(photo) && !existsSync(viewerAbs(photo))) return true
  return false
}

/** True when src is an https CDN URL under photos/variants (thumb). */
function isCdnVariantsThumbSrc(src, cdn) {
  if (!src || typeof src !== 'string') return false
  if (!/^https?:\/\//i.test(src)) return false
  try {
    const u = new URL(src)
    if (!u.pathname.includes('/photos/variants/')) return false
    if (!u.pathname.endsWith('-thumb.webp') && !u.pathname.endsWith('.webp')) return false
    // Prefer matching our CDN host when known; still accept other https variants paths.
    const host = new URL(normalizeCdn(cdn)).host
    if (u.host && host && u.host !== host) {
      // Still treat as CDN thumb if path looks right (custom CDN alias).
      return true
    }
    return true
  } catch {
    return false
  }
}

function originalKey(photo) {
  return photo.source?.bucketKey || photo.meta?.r2Key || null
}

function originalUrl(photo, cdn) {
  const key = originalKey(photo)
  if (key) return publicCdnUrl(cdn, key)
  const src = photo.variants?.original?.src
  return src && /^https?:\/\//i.test(src) ? src : null
}

function labelOf(photo) {
  return `${photo.meta?.album || photo.source?.album || '?'}/${photo.source?.filename || photo.id}`
}

function assetPolicyForThumb(thumbSrc) {
  if (thumbSrc && /^https?:\/\//i.test(thumbSrc) && String(thumbSrc).includes('/photos/variants/')) {
    return 'r2-original-r2-thumb'
  }
  return 'r2-original-local-thumb'
}

function withThumb(photo, cdn, { thumb, viewer, originalMeta }) {
  const original = {
    src: originalUrl(photo, cdn),
    width: originalMeta?.width || photo.variants?.original?.width || thumb.width,
    height: originalMeta?.height || photo.variants?.original?.height || thumb.height,
    type: originalMeta?.type || photo.variants?.original?.type || 'image/jpeg'
  }
  const ratio =
    original.width && original.height
      ? original.width / original.height
      : thumb.width && thumb.height
        ? thumb.width / thumb.height
        : photo.meta?.ratio
  const nextViewer = viewer || readViewerVariant({ ...photo, variants: { ...photo.variants, original } })
  const variants = {
    original,
    thumbnail: thumb
  }
  if (nextViewer) variants.viewer = nextViewer

  return {
    ...photo,
    variants,
    meta: {
      ...photo.meta,
      ...(ratio ? { ratio } : {}),
      assetPolicy: assetPolicyForThumb(thumb.src)
    }
  }
}

/**
 * Strip preview/large; keep only original + thumbnail.
 * Prefer existing CDN thumb URL when present (even if local disk also has the file).
 * Otherwise prefer on-disk local path; fall back to distinct thumbnail or original.
 */
function normalizeVariants(photo, cdn) {
  const originalSrc = originalUrl(photo, cdn) || photo.variants?.original?.src || null
  const original = {
    src: originalSrc,
    width: photo.variants?.original?.width,
    height: photo.variants?.original?.height,
    type: photo.variants?.original?.type || 'image/jpeg'
  }

  const expectedLocalSrc = thumbUrl(photo)
  const expectedCdnSrc = thumbCdnUrl(photo, cdn)
  const existingThumb = photo.variants?.thumbnail
  let thumbnail = null

  // Prefer CDN thumb already written into photos.json (production), even if local disk exists.
  if (existingThumb?.src && isCdnVariantsThumbSrc(existingThumb.src, cdn)) {
    thumbnail = {
      src: existingThumb.src === expectedCdnSrc ? expectedCdnSrc : existingThumb.src,
      width: existingThumb.width,
      height: existingThumb.height,
      type: existingThumb.type || 'image/webp'
    }
  } else if (existsSync(thumbAbs(photo))) {
    const existing =
      existingThumb?.src === expectedLocalSrc || existingThumb?.src === expectedCdnSrc
        ? existingThumb
        : null
    thumbnail = {
      src: expectedLocalSrc,
      width: existing?.width || existingThumb?.width,
      height: existing?.height || existingThumb?.height,
      type: existing?.type || existingThumb?.type || 'image/webp'
    }
  } else {
    if (
      existingThumb?.src &&
      existingThumb.src !== originalSrc &&
      !String(existingThumb.src).includes('/preview') &&
      existingThumb.src !== photo.variants?.preview?.src
    ) {
      // Keep a distinct non-original thumbnail path mid-migration (CDN or local).
      thumbnail = {
        src: existingThumb.src,
        width: existingThumb.width,
        height: existingThumb.height,
        type: existingThumb.type
      }
    } else if (existingThumb?.src) {
      thumbnail = {
        src: existingThumb.src,
        width: existingThumb.width || original.width,
        height: existingThumb.height || original.height,
        type: existingThumb.type || original.type
      }
    } else if (originalSrc) {
      thumbnail = {
        src: originalSrc,
        width: original.width,
        height: original.height,
        type: original.type
      }
    }
  }

  const ratio =
    original.width && original.height
      ? original.width / original.height
      : thumbnail?.width && thumbnail?.height
        ? thumbnail.width / thumbnail.height
        : photo.meta?.ratio

  const variants = { original }
  if (thumbnail) variants.thumbnail = thumbnail
  const viewer = readViewerVariant({ ...photo, variants: { ...photo.variants, original, thumbnail } })
  if (viewer) variants.viewer = viewer

  const nextMeta = {
    ...photo.meta,
    ...(ratio ? { ratio } : {})
  }
  if (thumbnail?.src) {
    nextMeta.assetPolicy = assetPolicyForThumb(thumbnail.src)
  }

  return {
    ...photo,
    variants,
    meta: nextMeta
  }
}

async function downloadBuffer(photo, { cdn, accountId, apiToken, bucket, preferApi }) {
  const key = originalKey(photo)
  const cdnSrc = originalUrl(photo, cdn)
  if (!key && !cdnSrc) throw new Error(`No original for ${photo.id}`)

  const canApi = Boolean(key && accountId && apiToken && bucket)
  const order = []
  if (preferApi && canApi) {
    order.push('api')
    if (cdnSrc) order.push('cdn')
  } else {
    if (cdnSrc) order.push('cdn')
    if (canApi) order.push('api')
  }

  const errors = []
  for (const mode of order) {
    const response =
      mode === 'api'
        ? await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`,
            { headers: { Authorization: `Bearer ${apiToken}` } }
          )
        : await fetch(cdnSrc, { headers: CDN_HEADERS, redirect: 'follow' })

    if (!response.ok) {
      errors.push(`${mode}: HTTP ${response.status}`)
      continue
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 32) {
      errors.push(`${mode}: body too small`)
      continue
    }
    return buffer
  }

  const help = canApi
    ? ''
    : ' Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (R2 Read) on Vercel.'
  throw new Error(`Download failed for ${photo.id} (${errors.join('; ')}).${help}`)
}

/**
 * Upload thumb bytes to R2 via Cloudflare HTTP API PUT.
 * Does not log secrets.
 */
async function uploadThumbToR2(photo, body, { accountId, apiToken, bucket }) {
  const key = thumbKey(photo)
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'image/webp'
    },
    body
  })
  if (!response.ok) {
    let detail = ''
    try {
      const text = await response.text()
      if (text) detail = ` ${text.slice(0, 200)}`
    } catch {
      // ignore body parse errors
    }
    throw new Error(`R2 PUT ${key} HTTP ${response.status}${detail}`)
  }
  return key
}

/**
 * EXIF Orientation 5–8 swap display axes. Sharp .metadata() before/without
 * applying rotate can still report sensor-native landscape pixels.
 */
function orientedSize(width, height, orientation) {
  const o = Number(orientation) || 1
  if (o >= 5 && o <= 8) {
    return { width: height, height: width }
  }
  return { width, height }
}

async function encodeThumb(photo, imageBuffer) {
  // Read raw metadata (includes orientation) then bake orientation into pixels for thumbs.
  const rawMeta = await sharp(imageBuffer, SHARP_OPTS).metadata()
  if (!rawMeta.width || !rawMeta.height) throw new Error('Unable to read dimensions')

  const display = orientedSize(rawMeta.width, rawMeta.height, rawMeta.orientation)

  const { data, info } = await sharp(imageBuffer, SHARP_OPTS)
    .rotate() // apply EXIF orientation so thumb pixels match display
    .resize({ width: Math.min(THUMB_WIDTH, display.width), withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: Math.min(6, Math.max(0, THUMB_EFFORT || 2)) })
    .toBuffer({ resolveWithObject: true })

  writeFileSync(thumbAbs(photo), data)

  const originalMeta = {
    width: display.width,
    height: display.height,
    type:
      rawMeta.format === 'jpeg' || rawMeta.format === 'jpg'
        ? 'image/jpeg'
        : `image/${rawMeta.format || 'jpeg'}`
  }

  let viewer = null
  const viewerWidth = Math.min(VIEWER_WIDTH, display.width)
  if (encodeViewersEnabled() && viewerWidth > THUMB_WIDTH) {
    const encoded = await sharp(imageBuffer, SHARP_OPTS)
      .rotate()
      .resize({ width: viewerWidth, withoutEnlargement: true })
      .webp({ quality: VIEWER_QUALITY, effort: Math.min(6, Math.max(0, THUMB_EFFORT || 2)) })
      .toBuffer({ resolveWithObject: true })
    writeFileSync(viewerAbs(photo), encoded.data)
    viewer = {
      src: viewerUrl(photo),
      width: encoded.info.width,
      height: encoded.info.height,
      type: 'image/webp'
    }
  }

  return {
    thumbBuffer: data,
    thumb: {
      src: thumbUrl(photo),
      width: info.width,
      height: info.height,
      type: 'image/webp'
    },
    viewer,
    originalMeta
  }
}

/**
 * Hydrate photo from on-disk thumb. Prefer existing CDN URL in photos.json
 * when present with dimensions (do not rewrite to local path).
 */
async function hydrateFromDisk(photo, cdn) {
  const abs = thumbAbs(photo)
  if (!existsSync(abs)) return null

  const existing = photo.variants?.thumbnail
  const expectedLocal = thumbUrl(photo)
  const expectedCdn = thumbCdnUrl(photo, cdn)

  // Prefer CDN thumb already in photos.json (production manifest).
  if (
    existing?.src &&
    isCdnVariantsThumbSrc(existing.src, cdn) &&
    existing.width &&
    existing.height &&
    photo.variants?.original?.src
  ) {
    return withThumb(photo, cdn, {
      thumb: {
        src: existing.src === expectedCdn ? expectedCdn : existing.src,
        width: existing.width,
        height: existing.height,
        type: existing.type || 'image/webp'
      },
      originalMeta: {
        width: photo.variants.original.width,
        height: photo.variants.original.height,
        type: photo.variants.original.type
      }
    })
  }

  // Prefer existing dimensions when path already matches local or CDN (skip sharp).
  if (
    (existing?.src === expectedLocal || existing?.src === expectedCdn) &&
    existing.width &&
    existing.height &&
    photo.variants?.original?.src
  ) {
    // Keep CDN if that was what was stored; otherwise local.
    const src = isCdnVariantsThumbSrc(existing.src, cdn) ? existing.src : expectedLocal
    return withThumb(photo, cdn, {
      thumb: {
        src,
        width: existing.width,
        height: existing.height,
        type: existing.type || 'image/webp'
      },
      originalMeta: {
        width: photo.variants.original.width,
        height: photo.variants.original.height,
        type: photo.variants.original.type
      }
    })
  }

  try {
    const meta = await sharp(abs, SHARP_OPTS).metadata()
    // If photos.json already has CDN src, keep it with measured dims.
    const src =
      existing?.src && isCdnVariantsThumbSrc(existing.src, cdn)
        ? existing.src
        : expectedLocal
    let viewer = readViewerVariant(photo)
    if (viewer && (!viewer.width || !viewer.height) && existsSync(viewerAbs(photo))) {
      const viewerMeta = await sharp(viewerAbs(photo), SHARP_OPTS).metadata()
      viewer = {
        ...viewer,
        width: viewerMeta.width,
        height: viewerMeta.height
      }
    }
    return withThumb(photo, cdn, {
      thumb: {
        src,
        width: meta.width,
        height: meta.height,
        type: 'image/webp'
      },
      viewer,
      originalMeta: {
        width: photo.variants?.original?.width,
        height: photo.variants?.original?.height,
        type: photo.variants?.original?.type
      }
    })
  } catch {
    return null
  }
}

/**
 * After encode/hydrate: optionally upload local thumb to R2 and rewrite src to CDN.
 * Returns { photo, uploaded: boolean } — photo may be unchanged on failure.
 */
async function maybeUploadThumb(photo, cdn, uploadCtx, { thumbBuffer } = {}) {
  const { shouldUpload, dryRun, accountId, apiToken, bucket } = uploadCtx
  if (!shouldUpload) return { photo, uploaded: false }

  const existingSrc = photo.variants?.thumbnail?.src
  if (existingSrc && isCdnVariantsThumbSrc(existingSrc, cdn)) {
    // Already on CDN; ensure policy is set.
    if (photo.meta?.assetPolicy === 'r2-original-r2-thumb') {
      return { photo, uploaded: false }
    }
    return {
      photo: {
        ...photo,
        meta: { ...photo.meta, assetPolicy: 'r2-original-r2-thumb' }
      },
      uploaded: false
    }
  }

  const abs = thumbAbs(photo)
  let body = thumbBuffer
  if (!body) {
    if (!existsSync(abs)) return { photo, uploaded: false }
    body = readFileSync(abs)
  }

  const key = thumbKey(photo)
  const cdnSrc = thumbCdnUrl(photo, cdn)

  if (dryRun) {
    console.log(`  would upload ${labelOf(photo)} → ${key}`)
    return {
      photo: withThumb(photo, cdn, {
        thumb: {
          src: cdnSrc,
          width: photo.variants?.thumbnail?.width,
          height: photo.variants?.thumbnail?.height,
          type: photo.variants?.thumbnail?.type || 'image/webp'
        },
        originalMeta: photo.variants?.original
      }),
      uploaded: true
    }
  }

  await uploadThumbToR2(photo, body, { accountId, apiToken, bucket })
  const next = withThumb(photo, cdn, {
    thumb: {
      src: cdnSrc,
      width: photo.variants?.thumbnail?.width,
      height: photo.variants?.thumbnail?.height,
      type: photo.variants?.thumbnail?.type || 'image/webp'
    },
    originalMeta: photo.variants?.original
  })
  return { photo: next, uploaded: true }
}

async function main() {
  loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage: npm run photos:build-variants -- [options]

Afilmory model: thumbs are site static files under images/photos/variants/.
Originals stay on R2/CDN (read only). R2 write is optional and off by default.

Options:
  --prebuilt-only   Never download/encode; only hydrate existing on-disk thumbs
                    (also: PHOTOS_PREBUILT_ONLY=1). For local rebuilds when thumbs exist.
  --upload          Optional: upload thumbs to R2 and rewrite CDN URLs (needs R2 Write)
                    (also: PHOTOS_UPLOAD_THUMBS=1). Not used by default deploy.
  --dry-run         Log only; no writes
  --force           Re-encode even when on-disk thumb exists
  --limit=N         Encode only first N selected photos
  PHOTOS_ENCODE_VIEWERS=all   Also download originals to backfill missing 1920w viewers
  PHOTOS_SITE_ORIGIN          Existing-site origin used to reuse deployed variants (default https://site.bazinga.ink)
  --album=NAME      Filter by album
  --concurrency=N   Parallelism (default 4 local, 8 on CI/Vercel)
  -h, --help

Typical:
  npm run build:site                                 # encode missing + jekyll (deploy)
  npm run photos:build-variants -- --concurrency=8   # full/missing encode
  npm run photos:build-variants:prebuilt             # hydrate only
  npm run photos:build-variants:upload               # optional R2 push
`)
    return
  }

  const dataPath = path.resolve(repoRoot, process.env.PHOTOS_DATA_PATH || '_data/photos.json')
  const cdn = normalizeCdn()
  const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
  // Prefer public CDN for originals (Afilmory-style read). API only when forced.
  const preferApi =
    process.env.PHOTOS_DOWNLOAD_MODE === 'api' || process.env.PHOTOS_DOWNLOAD_MODE === 'r2'

  const canUpload = Boolean(accountId && apiToken && bucket)
  // Upload is explicit only — default deploy does not write thumbs to R2.
  const shouldUpload = Boolean(options.upload && canUpload)

  if (!existsSync(dataPath)) throw new Error(`Missing ${dataPath}. Run photos:sync-from-r2 first.`)
  if (!options.dryRun) mkdirSync(VARIANTS_DIR, { recursive: true })

  const photos = JSON.parse(readFileSync(dataPath, 'utf8'))
  if (!Array.isArray(photos) || photos.length === 0) {
    console.log('photos.json empty; skip')
    return
  }

  let list = photos
  if (options.album) {
    list = list.filter((p) => (p.meta?.album || p.source?.album) === options.album)
  }
  if (Number.isFinite(options.limit)) list = list.slice(0, options.limit)

  const downloadCtx = { cdn, accountId, apiToken, bucket, preferApi }
  const uploadCtx = {
    shouldUpload,
    dryRun: options.dryRun,
    accountId,
    apiToken,
    bucket
  }
  const modeLabel = options.prebuiltOnly
    ? 'prebuilt-only'
    : preferApi
      ? 'api-first'
      : 'cdn-first'
  console.log(
    `Thumbs: total=${photos.length} selected=${list.length} concurrency=${options.concurrency} ` +
      `mode=${modeLabel} api=${Boolean(accountId && apiToken)} upload=${shouldUpload}` +
      (options.dryRun ? ' dry-run' : '')
  )
  if ((options.upload || process.env.PHOTOS_UPLOAD_THUMBS) && !canUpload) {
    console.warn(
      'Upload requested but missing credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_BUCKET); keeping local thumb paths'
    )
  }

  const byId = new Map(photos.map((p) => [p.id, p]))
  let built = 0
  let reused = 0
  let failed = 0
  let skipped = 0
  let uploaded = 0
  let uploadFailed = 0

  if (options.prebuiltOnly) {
    // Never download/encode: hydrate existing on-disk thumbs only.
    for (const photo of list) {
      const label = labelOf(photo)
      if (!existsSync(thumbAbs(photo))) {
        // Still keep CDN URL if already present in photos.json.
        if (photo.variants?.thumbnail?.src && isCdnVariantsThumbSrc(photo.variants.thumbnail.src, cdn)) {
          byId.set(photo.id, normalizeVariants(photo, cdn))
          reused += 1
          continue
        }
        skipped += 1
        if (options.dryRun) console.log(`  skip (no thumb on disk) ${label}`)
        continue
      }
      if (options.dryRun) {
        console.log(`  would hydrate ${label} → ${thumbUrl(photo)}`)
        reused += 1
        if (shouldUpload) {
          console.log(`  would upload ${label} → ${thumbKey(photo)}`)
          uploaded += 1
        }
        continue
      }
      const hydrated = await hydrateFromDisk(photo, cdn)
      if (hydrated) {
        try {
          const result = await maybeUploadThumb(hydrated, cdn, uploadCtx)
          byId.set(photo.id, result.photo)
          reused += 1
          if (result.uploaded) uploaded += 1
        } catch (error) {
          byId.set(photo.id, hydrated)
          reused += 1
          uploadFailed += 1
          console.error(`  upload fail ${label}: ${error.message || error}`)
        }
      } else {
        skipped += 1
      }
    }

    // Also hydrate on-disk thumbs outside --album/--limit selection (no upload).
    for (const photo of photos) {
      if (byId.get(photo.id) !== photo) continue
      if (!existsSync(thumbAbs(photo))) continue
      if (options.dryRun) {
        console.log(`  would hydrate (rest) ${labelOf(photo)}`)
        reused += 1
        continue
      }
      const hydrated = await hydrateFromDisk(photo, cdn)
      if (hydrated) {
        byId.set(photo.id, hydrated)
        reused += 1
      }
    }
  } else {
    if (!options.dryRun) {
      await mapPool(list, options.concurrency, (photo) => ensureLocalDerivatives(photo))
    }
    const needsDownload = list.some((p) => needsEncode(p, options))
    if (needsDownload && !options.dryRun) {
      const sample = list.find((p) => options.force || !existsSync(thumbAbs(p))) || list[0]
      try {
        const buf = await downloadBuffer(sample, downloadCtx)
        console.log(`Preflight ok (${buf.length} bytes)`)
      } catch (error) {
        throw new Error(
          `${error.message}\n\nNeed public CDN originals (PHOTOS_CDN=${cdn}) or R2 read credentials. ` +
            `Thumbs are written to images/photos/variants/ and shipped with the site (Afilmory model).`
        )
      }
    }

    await mapPool(list, options.concurrency, async (photo) => {
      const label = labelOf(photo)
      try {
        if (!options.force && !needsEncode(photo)) {
          if (options.dryRun) {
            console.log(`  would reuse ${label}`)
            reused += 1
            if (shouldUpload) {
              console.log(`  would upload ${label} → ${thumbKey(photo)}`)
              uploaded += 1
            }
            return
          }
          const hydrated = await hydrateFromDisk(photo, cdn)
          if (hydrated) {
            try {
              const result = await maybeUploadThumb(hydrated, cdn, uploadCtx)
              byId.set(photo.id, result.photo)
              reused += 1
              if (result.uploaded) {
                uploaded += 1
                console.log(`  reused+upload ${label}`)
              }
            } catch (error) {
              byId.set(photo.id, hydrated)
              reused += 1
              uploadFailed += 1
              console.error(`  upload fail ${label}: ${error.message || error}`)
            }
            return
          }
        }

        if (options.dryRun) {
          console.log(`  would encode ${label}`)
          built += 1
          if (shouldUpload) {
            console.log(`  would upload ${label} → ${thumbKey(photo)}`)
            uploaded += 1
          }
          return
        }

        const buffer = await downloadBuffer(photo, downloadCtx)
        const generated = await encodeThumb(photo, buffer)
        let next = withThumb(photo, cdn, generated)
        try {
          const result = await maybeUploadThumb(next, cdn, uploadCtx, {
            thumbBuffer: generated.thumbBuffer
          })
          next = result.photo
          if (result.uploaded) uploaded += 1
        } catch (error) {
          uploadFailed += 1
          console.error(`  upload fail ${label}: ${error.message || error}`)
        }
        byId.set(photo.id, next)
        built += 1
        const srcNote = next.variants?.thumbnail?.src?.startsWith('http') ? 'cdn' : 'local'
        console.log(
          `  ok ${label} → ${generated.thumb.width}x${generated.thumb.height} (${srcNote})`
        )
      } catch (error) {
        failed += 1
        console.error(`  fail ${label}: ${error.message || error}`)
      }
    })

    // Apply on-disk thumbs for photos outside --album/--limit selection (no upload).
    for (const photo of photos) {
      if (byId.get(photo.id) !== photo) continue
      if (!existsSync(thumbAbs(photo))) continue
      if (options.dryRun) {
        console.log(`  would hydrate (rest) ${labelOf(photo)}`)
        reused += 1
        continue
      }
      const hydrated = await hydrateFromDisk(photo, cdn)
      if (hydrated) {
        byId.set(photo.id, hydrated)
        reused += 1
      }
    }
  }

  const next = sortPhotosNewestFirst(
    photos.map((p) => normalizeVariants(byId.get(p.id) || p, cdn))
  )

  if (options.dryRun) {
    console.log(
      `Dry-run: would write ${dataPath} (built=${built} reused=${reused} skipped=${skipped} ` +
        `failed=${failed} uploaded=${uploaded} uploadFailed=${uploadFailed}); no files written`
    )
  } else {
    writeFileSync(dataPath, `${JSON.stringify(next, null, 2)}\n`)
    console.log(
      `Done. built=${built} reused=${reused} skipped=${skipped} failed=${failed} ` +
        `uploaded=${uploaded} uploadFailed=${uploadFailed} (variants: thumbnail+viewer+original)`
    )
  }

  if (failed > 0 || uploadFailed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
