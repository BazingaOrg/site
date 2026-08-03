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
 * Afilmory-style deploy thumbs (no R2 write):
 *   download original → one ~720w WebP list thumb → images/photos/variants/
 *   list/home use thumb; lightbox uses CDN original
 *
 *   npm run photos:build-variants -- [--force] [--limit=N] [--album=NAME] [--concurrency=N]
 */

const THUMB_WIDTH = Number(process.env.PHOTOS_THUMB_WIDTH || 720) || 720
const THUMB_QUALITY = Number(process.env.PHOTOS_THUMB_QUALITY || 78) || 78
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
    concurrency: Number(process.env.PHOTOS_BUILD_CONCURRENCY || 2) || 2,
    help: false
  }
  for (const arg of argv) {
    if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
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

function withThumb(photo, cdn, { thumb, originalMeta }) {
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

  return {
    ...photo,
    variants: {
      original,
      thumbnail: thumb,
      preview: thumb,
      large: { ...original }
    },
    meta: {
      ...photo.meta,
      ...(ratio ? { ratio } : {}),
      assetPolicy: 'r2-original-local-thumb'
    }
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

async function encodeThumb(photo, imageBuffer) {
  const pipeline = sharp(imageBuffer, SHARP_OPTS).rotate()
  const metadata = await pipeline.metadata()
  if (!metadata.width || !metadata.height) throw new Error('Unable to read dimensions')

  const { data, info } = await pipeline
    .clone()
    .resize({ width: Math.min(THUMB_WIDTH, metadata.width), withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true })

  writeFileSync(thumbAbs(photo), data)

  return {
    thumb: {
      src: thumbUrl(photo),
      width: info.width,
      height: info.height,
      type: 'image/webp'
    },
    originalMeta: {
      width: metadata.width,
      height: metadata.height,
      type:
        metadata.format === 'jpeg' || metadata.format === 'jpg'
          ? 'image/jpeg'
          : `image/${metadata.format || 'jpeg'}`
    }
  }
}

async function hydrateFromDisk(photo, cdn) {
  const abs = thumbAbs(photo)
  if (!existsSync(abs)) return null

  // Prefer existing dimensions in photos.json when path already matches (skip sharp).
  const existing = photo.variants?.preview
  if (
    existing?.src === thumbUrl(photo) &&
    existing.width &&
    existing.height &&
    photo.variants?.original?.src
  ) {
    return withThumb(photo, cdn, {
      thumb: {
        src: existing.src,
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
    return withThumb(photo, cdn, {
      thumb: {
        src: thumbUrl(photo),
        width: meta.width,
        height: meta.height,
        type: 'image/webp'
      },
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

async function main() {
  loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage: npm run photos:build-variants -- [--force] [--limit=N] [--album=NAME] [--concurrency=N]`)
    return
  }

  const dataPath = path.resolve(repoRoot, process.env.PHOTOS_DATA_PATH || '_data/photos.json')
  const cdn = normalizeCdn()
  const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
  const preferApi =
    process.env.PHOTOS_DOWNLOAD_MODE === 'api' ||
    process.env.PHOTOS_DOWNLOAD_MODE === 'r2' ||
    process.env.VERCEL === '1' ||
    process.env.CI === 'true' ||
    Boolean(accountId && apiToken)

  if (!existsSync(dataPath)) throw new Error(`Missing ${dataPath}. Run photos:sync-from-r2 first.`)
  mkdirSync(VARIANTS_DIR, { recursive: true })

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
  console.log(
    `Thumbs: total=${photos.length} selected=${list.length} concurrency=${options.concurrency} ` +
      `mode=${preferApi ? 'api-first' : 'cdn-first'} api=${Boolean(accountId && apiToken)}`
  )

  const needsDownload = list.some((p) => options.force || !existsSync(thumbAbs(p)))
  if (needsDownload) {
    const sample = list.find((p) => options.force || !existsSync(thumbAbs(p))) || list[0]
    try {
      const buf = await downloadBuffer(sample, downloadCtx)
      console.log(`Preflight ok (${buf.length} bytes)`)
    } catch (error) {
      throw new Error(
        `${error.message}\n\nVercel env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (R2 Read), ` +
          `R2_BUCKET=${DEFAULT_BUCKET}, PHOTOS_CDN=${cdn}`
      )
    }
  }

  const byId = new Map(photos.map((p) => [p.id, p]))
  let built = 0
  let reused = 0
  let failed = 0

  await mapPool(list, options.concurrency, async (photo) => {
    const label = labelOf(photo)
    try {
      if (!options.force && existsSync(thumbAbs(photo))) {
        const hydrated = await hydrateFromDisk(photo, cdn)
        if (hydrated) {
          byId.set(photo.id, hydrated)
          reused += 1
          return
        }
      }

      const buffer = await downloadBuffer(photo, downloadCtx)
      const generated = await encodeThumb(photo, buffer)
      byId.set(photo.id, withThumb(photo, cdn, generated))
      built += 1
      console.log(`  ok ${label} → ${generated.thumb.width}x${generated.thumb.height}`)
    } catch (error) {
      failed += 1
      console.error(`  fail ${label}: ${error.message || error}`)
    }
  })

  // Apply on-disk thumbs for photos outside --album/--limit selection.
  for (const photo of photos) {
    if (byId.get(photo.id) !== photo) continue
    if (!existsSync(thumbAbs(photo))) continue
    const hydrated = await hydrateFromDisk(photo, cdn)
    if (hydrated) {
      byId.set(photo.id, hydrated)
      reused += 1
    }
  }

  writeFileSync(
    dataPath,
    `${JSON.stringify(
      sortPhotosNewestFirst(photos.map((p) => byId.get(p.id) || p)),
      null,
      2
    )}\n`
  )

  console.log(`Done. built=${built} reused=${reused} failed=${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
