import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Afilmory-style deploy pipeline (no R2 write):
 *   download original from CDN/R2 → sharp WebP derivatives → write under
 *   images/photos/variants/ → rewrite _data/photos.json local paths → Jekyll copies into _site
 *
 * Examples:
 *   npm run photos:build-variants -- --limit=3
 *   npm run photos:build-variants -- --album=20240803桌面
 *   npm run photos:build-variants -- --force
 *
 * Env (optional):
 *   PHOTOS_CDN=https://img.bazinga.ink
 *   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN  (fallback download if CDN blocked)
 *   R2_BUCKET=bazinga-gallery
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const DERIVATIVE_SPECS = [
  { key: 'thumbnail', width: 360, webpQuality: 74 },
  { key: 'preview', width: 960, webpQuality: 78 },
  { key: 'large', width: 2160, webpQuality: 82 }
]

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

function variantFileName(photo, sizeKey) {
  return `${safeVariantBase(photo)}-${sizeKey}.webp`
}

function variantPublicPath(photo, sizeKey) {
  return `${VARIANTS_PUBLIC_PREFIX}/${variantFileName(photo, sizeKey)}`
}

function variantAbsolutePath(photo, sizeKey) {
  return path.join(VARIANTS_DIR, variantFileName(photo, sizeKey))
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

function allVariantsOnDisk(photo) {
  return DERIVATIVE_SPECS.every((spec) => existsSync(variantAbsolutePath(photo, spec.key)))
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

async function generateAndWrite(photo, imageBuffer) {
  const rotated = sharp(imageBuffer, { failOn: 'none', limitInputPixels: false }).rotate()
  const metadata = await rotated.metadata()
  const originalWidth = metadata.width
  const originalHeight = metadata.height
  if (!originalWidth || !originalHeight) {
    throw new Error('Unable to read image dimensions')
  }

  const generated = {
    original: {
      width: originalWidth,
      height: originalHeight,
      type: metadata.format === 'jpeg' || metadata.format === 'jpg' ? 'image/jpeg' : `image/${metadata.format || 'jpeg'}`
    },
    derivatives: {}
  }

  for (const spec of DERIVATIVE_SPECS) {
    const targetWidth = Math.min(spec.width, originalWidth)
    const { data, info } = await sharp(imageBuffer, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: spec.webpQuality, effort: 4 })
      .toBuffer({ resolveWithObject: true })

    const absolute = variantAbsolutePath(photo, spec.key)
    writeFileSync(absolute, data)
    generated.derivatives[spec.key] = {
      src: variantPublicPath(photo, spec.key),
      width: info.width,
      height: info.height,
      type: 'image/webp'
    }
  }

  return {
    ratio: originalWidth / originalHeight,
    ...generated
  }
}

function applyToPhoto(photo, cdn, generated) {
  const key = originalKey(photo)
  const original = {
    src: originalSrc(photo, cdn),
    width: generated.original.width,
    height: generated.original.height,
    type: photo.variants?.original?.type || generated.original.type
  }
  if (key) {
    // keep CDN original even if something rewrote it earlier
    original.src = publicCdnUrl(cdn, key)
  }

  return {
    ...photo,
    variants: {
      original,
      ...generated.derivatives
    },
    meta: {
      ...photo.meta,
      ratio: generated.ratio,
      assetPolicy: photo.meta?.assetPolicy || 'r2-original-local-derivatives'
    }
  }
}

function hydrateFromDisk(photo, cdn) {
  if (!allVariantsOnDisk(photo)) return null
  // Read dimensions from first available file via sharp metadata (cheap)
  // Use preview as representative if present
  return null // filled async below
}

async function hydrateFromDiskAsync(photo, cdn) {
  if (!allVariantsOnDisk(photo)) return null
  try {
    const originalBufferMeta = {
      width: photo.variants?.original?.width,
      height: photo.variants?.original?.height,
      type: photo.variants?.original?.type
    }
    const derivatives = {}
    for (const spec of DERIVATIVE_SPECS) {
      const absolute = variantAbsolutePath(photo, spec.key)
      const meta = await sharp(absolute).metadata()
      derivatives[spec.key] = {
        src: variantPublicPath(photo, spec.key),
        width: meta.width,
        height: meta.height,
        type: 'image/webp'
      }
    }
    const preview = derivatives.preview
    const ratio =
      photo.meta?.ratio ||
      (preview?.width && preview?.height ? preview.width / preview.height : null) ||
      (originalBufferMeta.width && originalBufferMeta.height
        ? originalBufferMeta.width / originalBufferMeta.height
        : null)

    const key = originalKey(photo)
    return {
      ...photo,
      variants: {
        original: {
          src: key ? publicCdnUrl(cdn, key) : originalSrc(photo, cdn),
          width: originalBufferMeta.width || preview?.width,
          height: originalBufferMeta.height || preview?.height,
          type: originalBufferMeta.type || 'image/jpeg'
        },
        ...derivatives
      },
      meta: {
        ...photo.meta,
        ...(ratio ? { ratio } : {}),
        assetPolicy: photo.meta?.assetPolicy || 'r2-original-local-derivatives'
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

  const needsDownload = list.some((photo) => !(options.skipExisting && allVariantsOnDisk(photo)))
  if (needsDownload) {
    await preflightDownload({
      cdn,
      accountId,
      apiToken,
      bucket,
      preferApi,
      samplePhoto: list.find((photo) => !(options.skipExisting && allVariantsOnDisk(photo))) || list[0]
    })
  }

  const byId = new Map(photos.map((p) => [p.id, p]))
  let built = 0
  let reused = 0
  let failed = 0

  await mapPool(list, options.concurrency, async (photo) => {
    const label = `${photo.meta?.album || '?'}/${photo.source?.filename || photo.id}`
    try {
      if (options.skipExisting && allVariantsOnDisk(photo)) {
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
      console.log(
        `  ok ${label} → preview ${generated.derivatives.preview.width}x${generated.derivatives.preview.height}`
      )
    } catch (error) {
      failed += 1
      console.error(`  fail ${label}: ${error.message || error}`)
    }
  })

  // Hydrate any on-disk variants not touched this run (e.g. previous deploys / partial runs).
  for (const photo of photos) {
    if (byId.get(photo.id) !== photo) continue
    if (!allVariantsOnDisk(photo)) continue
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
