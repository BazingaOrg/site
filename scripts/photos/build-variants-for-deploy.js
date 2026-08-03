import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Afilmory-style deploy pipeline (no R2 write):
 *   download original from CDN/R2 → one list thumbnail WebP → images/photos/variants/
 *   → rewrite _data/photos.json → Jekyll copies into _site
 *
 * Alignment with afilmory:
 *   - one derivative (~720w) for lists / progressive placeholder
 *   - full-size viewer uses CDN original (variants.large === original)
 *
 * Examples:
 *   npm run photos:build-variants -- --limit=3
 *   npm run photos:build-variants -- --album=20240803桌面
 *   npm run photos:build-variants -- --force
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

// Single list derivative (afilmory uses ~600px JPEG; we use WebP ~720 for density).
const THUMB_SPEC = { key: 'thumb', width: 720, webpQuality: 78 }

const VARIANTS_DIR = path.join(repoRoot, 'images', 'photos', 'variants')
const VARIANTS_PUBLIC_PREFIX = '/images/photos/variants'

function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env')
  if (!existsSync(envPath)) return
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function parseArgs(argv) {
  const options = {
    force: false,
    limit: null,
    album: null,
    concurrency: Number(process.env.PHOTOS_BUILD_CONCURRENCY || 2) || 2,
    help: false,
    skipExisting: true
  }
  for (const arg of argv) {
    if (arg === '--force') {
      options.force = true
      options.skipExisting = false
    } else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice('--limit='.length))
    else if (arg.startsWith('--album=')) options.album = arg.slice('--album='.length)
    else if (arg.startsWith('--concurrency=')) {
      options.concurrency = Math.max(1, Number(arg.slice('--concurrency='.length)) || 1)
    }
  }
  return options
}

function normalizeCdn(cdn) {
  return (cdn || 'https://img.bazinga.ink').replace(/\/$/, '')
}

function publicCdnUrl(cdn, key) {
  return `${cdn}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function encodeObjectPath(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

function safeVariantBase(photo) {
  return String(photo.id || 'photo')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'photo'
}

function thumbFileName(photo) {
  return `${safeVariantBase(photo)}-thumb.webp`
}

function thumbPublicPath(photo) {
  return `${VARIANTS_PUBLIC_PREFIX}/${thumbFileName(photo)}`
}

function thumbAbsolutePath(photo) {
  return path.join(VARIANTS_DIR, thumbFileName(photo))
}

function originalKey(photo) {
  return photo.source?.bucketKey || photo.meta?.r2Key || null
}

function originalSrc(photo, cdn) {
  const existing = photo.variants?.original?.src
  if (existing && /^https?:\/\//i.test(existing)) return existing
  const key = originalKey(photo)
  if (key) return publicCdnUrl(cdn, key)
  return existing || null
}

function thumbOnDisk(photo) {
  return existsSync(thumbAbsolutePath(photo))
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1))
  await Promise.all(Array.from({ length: n }, () => run()))
  return results
}

const CDN_FETCH_HEADERS = {
  // Some CF bot rules block bare datacenter clients (e.g. Vercel build).
  'User-Agent': 'Mozilla/5.0 (compatible; site-photos-build/1.0; +https://site.bazinga.ink)',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
}

async function downloadViaR2Api(key, { accountId, apiToken, bucket }) {
  const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`
  const response = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${apiToken}` }
  })
  return { response, label: `r2-api:${key}` }
}

async function downloadViaCdn(src) {
  const response = await fetch(src, { headers: CDN_FETCH_HEADERS, redirect: 'follow' })
  return { response, label: `cdn:${src}` }
}

/**
 * Prefer authenticated R2 API on CI (CDN often returns 403 to Vercel IPs).
 * Fall back to public CDN for local/dev without tokens.
 */
async function downloadOriginal(photo, { cdn, accountId, apiToken, bucket, preferApi }) {
  const src = originalSrc(photo, cdn)
  const key = originalKey(photo)
  if (!src && !key) throw new Error(`No original URL/key for ${photo.id}`)

  const attempts = []
  const canApi = Boolean(key && accountId && apiToken && bucket)

  if (preferApi && canApi) {
    attempts.push(() => downloadViaR2Api(key, { accountId, apiToken, bucket }))
    if (src) attempts.push(() => downloadViaCdn(src))
  } else {
    if (src) attempts.push(() => downloadViaCdn(src))
    if (canApi) attempts.push(() => downloadViaR2Api(key, { accountId, apiToken, bucket }))
  }

  const errors = []
  for (const attempt of attempts) {
    const { response, label } = await attempt()
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 32) {
        errors.push(`${label}: body too small (${buffer.length})`)
        continue
      }
      return buffer
    }
    const hint = response.headers.get('cf-mitigated') || response.headers.get('content-type') || ''
    errors.push(`${label}: HTTP ${response.status}${hint ? ` (${hint})` : ''}`)
  }

  const help = canApi
    ? ''
    : ' Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (R2 Read) on Vercel — public CDN is often blocked (403) from build IPs.'
  throw new Error(`Download failed for ${photo.id}. ${errors.join(' | ')}.${help}`)
}

async function preflightDownload({ cdn, accountId, apiToken, bucket, preferApi, samplePhoto }) {
  if (!samplePhoto) return
  console.log(
    `Download mode: ${preferApi ? 'R2 API first (recommended for Vercel)' : 'CDN first'}; ` +
      `apiCredentials=${Boolean(accountId && apiToken)}`
  )
  try {
    const buffer = await downloadOriginal(samplePhoto, {
      cdn,
      accountId,
      apiToken,
      bucket,
      preferApi
    })
    console.log(`Preflight download ok (${buffer.length} bytes) via configured source`)
  } catch (error) {
    throw new Error(
      `Preflight download failed — aborting before processing 1500 photos.\n${error.message}\n\n` +
        `Fix on Vercel → Project → Settings → Environment Variables:\n` +
        `  CLOUDFLARE_ACCOUNT_ID=<account id>\n` +
        `  CLOUDFLARE_API_TOKEN=<token with Account / Workers R2 Storage / Read>\n` +
        `  R2_BUCKET=bazinga-gallery\n` +
        `  PHOTOS_CDN=https://img.bazinga.ink\n` +
        `Then redeploy.`
    )
  }
}

function buildVariantRecord(src, width, height, type) {
  return { src, width, height, type }
}

async function generateAndWrite(photo, imageBuffer) {
  const metadata = await sharp(imageBuffer, { failOn: 'none', limitInputPixels: false }).rotate().metadata()
  const originalWidth = metadata.width
  const originalHeight = metadata.height
  if (!originalWidth || !originalHeight) {
    throw new Error('Unable to read image dimensions')
  }

  const targetWidth = Math.min(THUMB_SPEC.width, originalWidth)
  const { data, info } = await sharp(imageBuffer, { failOn: 'none', limitInputPixels: false })
    .rotate()
    .resize({ width: targetWidth, withoutEnlargement: true })
    .webp({ quality: THUMB_SPEC.webpQuality, effort: 4 })
    .toBuffer({ resolveWithObject: true })

  writeFileSync(thumbAbsolutePath(photo), data)

  const thumb = buildVariantRecord(
    thumbPublicPath(photo),
    info.width,
    info.height,
    'image/webp'
  )

  return {
    ratio: originalWidth / originalHeight,
    original: {
      width: originalWidth,
      height: originalHeight,
      type:
        metadata.format === 'jpeg' || metadata.format === 'jpg'
          ? 'image/jpeg'
          : `image/${metadata.format || 'jpeg'}`
    },
    thumb
  }
}

function applyToPhoto(photo, cdn, generated) {
  const key = originalKey(photo)
  const original = {
    src: key ? publicCdnUrl(cdn, key) : originalSrc(photo, cdn),
    width: generated.original.width,
    height: generated.original.height,
    type: photo.variants?.original?.type || generated.original.type
  }

  // List uses thumbnail/preview; lightbox href uses large → CDN original (afilmory-style).
  return {
    ...photo,
    variants: {
      original,
      thumbnail: generated.thumb,
      preview: generated.thumb,
      large: { ...original }
    },
    meta: {
      ...photo.meta,
      ratio: generated.ratio,
      assetPolicy: photo.meta?.assetPolicy || 'r2-original-local-thumb'
    }
  }
}

async function hydrateFromDiskAsync(photo, cdn) {
  if (!thumbOnDisk(photo)) return null
  try {
    const absolute = thumbAbsolutePath(photo)
    const meta = await sharp(absolute).metadata()
    const key = originalKey(photo)
    const original = {
      src: key ? publicCdnUrl(cdn, key) : originalSrc(photo, cdn),
      width: photo.variants?.original?.width || meta.width,
      height: photo.variants?.original?.height || meta.height,
      type: photo.variants?.original?.type || 'image/jpeg'
    }
    const thumb = buildVariantRecord(
      thumbPublicPath(photo),
      meta.width,
      meta.height,
      'image/webp'
    )
    const ratio =
      photo.meta?.ratio ||
      (original.width && original.height
        ? original.width / original.height
        : meta.width && meta.height
          ? meta.width / meta.height
          : null)

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
        assetPolicy: photo.meta?.assetPolicy || 'r2-original-local-thumb'
      }
    }
  } catch {
    return null
  }
}

async function main() {
  loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage:
  npm run photos:build-variants -- [options]

Options:
  --force            Rebuild even if local variants exist
  --limit=N          Process at most N photos
  --album=NAME       Only one album
  --concurrency=N    Parallel downloads/encodes (default 2)
`)
    return
  }

  const dataPath = path.resolve(repoRoot, process.env.PHOTOS_DATA_PATH || path.join('_data', 'photos.json'))
  const cdn = normalizeCdn(process.env.PHOTOS_CDN)
  const bucket = process.env.R2_BUCKET || 'bazinga-gallery'
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
  // CI/datacenter IPs often get CDN 403; use API first when credentials exist (or force via env).
  const preferApi =
    process.env.PHOTOS_DOWNLOAD_MODE === 'api' ||
    process.env.PHOTOS_DOWNLOAD_MODE === 'r2' ||
    process.env.VERCEL === '1' ||
    process.env.CI === 'true' ||
    Boolean(accountId && apiToken)

  if (!existsSync(dataPath)) {
    throw new Error(`Missing ${dataPath}. Run photos:sync-from-r2 first.`)
  }

  mkdirSync(VARIANTS_DIR, { recursive: true })

  const photos = JSON.parse(readFileSync(dataPath, 'utf8'))
  if (!Array.isArray(photos) || photos.length === 0) {
    console.log('photos.json empty; skip variant build')
    return
  }

  let list = photos
  if (options.album) {
    list = list.filter((p) => (p.meta?.album || p.source?.album) === options.album)
  }
  if (options.limit != null && Number.isFinite(options.limit)) {
    list = list.slice(0, options.limit)
  }

  console.log(
    `Build local variants (afilmory-style). total=${photos.length} selected=${list.length} concurrency=${options.concurrency}`
  )

  const needsDownload = list.some((photo) => !(options.skipExisting && thumbOnDisk(photo)))
  if (needsDownload) {
    await preflightDownload({
      cdn,
      accountId,
      apiToken,
      bucket,
      preferApi,
      samplePhoto: list.find((photo) => !(options.skipExisting && thumbOnDisk(photo))) || list[0]
    })
  }

  const byId = new Map(photos.map((p) => [p.id, p]))
  let built = 0
  let reused = 0
  let failed = 0

  await mapPool(list, options.concurrency, async (photo) => {
    const label = `${photo.meta?.album || '?'}/${photo.source?.filename || photo.id}`
    try {
      if (options.skipExisting && thumbOnDisk(photo)) {
        const hydrated = await hydrateFromDiskAsync(photo, cdn)
        if (hydrated) {
          byId.set(photo.id, hydrated)
          reused += 1
          console.log(`  reuse ${label}`)
          return
        }
      }

      process.stdout.write(`  build ${label}\n`)
      const buffer = await downloadOriginal(photo, {
        cdn,
        accountId,
        apiToken,
        bucket,
        preferApi
      })
      const generated = await generateAndWrite(photo, buffer)
      byId.set(photo.id, applyToPhoto(photo, cdn, generated))
      built += 1
      console.log(`  ok ${label} → thumb ${generated.thumb.width}x${generated.thumb.height}`)
    } catch (error) {
      failed += 1
      console.error(`  fail ${label}: ${error.message || error}`)
    }
  })

  // Hydrate any on-disk thumbs not touched this run (e.g. previous deploys / partial runs).
  for (const photo of photos) {
    if (byId.get(photo.id) !== photo) continue
    if (!thumbOnDisk(photo)) continue
    const hydrated = await hydrateFromDiskAsync(photo, cdn)
    if (hydrated) {
      byId.set(photo.id, hydrated)
      reused += 1
    }
  }

  // If --album/--limit, only merge processed; still rewrite full array from byId
  const nextPhotos = photos.map((p) => byId.get(p.id) || p)
  nextPhotos.sort((a, b) => {
    const ta = Date.parse(a.uploaded) || 0
    const tb = Date.parse(b.uploaded) || 0
    if (ta !== tb) return tb - ta
    return String(a.id).localeCompare(String(b.id))
  })
  writeFileSync(dataPath, `${JSON.stringify(nextPhotos, null, 2)}\n`)

  console.log(`Done. built=${built} reused=${reused} failed=${failed}`)
  console.log(`Variants dir: ${path.relative(repoRoot, VARIANTS_DIR)}`)
  console.log(`Updated ${path.relative(repoRoot, dataPath)}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
