import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Download R2 originals → sharp derivatives → upload back to R2 → update photos.json
 *
 * Auth:
 *   Download: public PHOTOS_CDN, or CLOUDFLARE_API_TOKEN (R2 Read)
 *   Upload:   CLOUDFLARE_API_TOKEN with R2 Edit/Write, or S3-compatible keys:
 *             R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ENDPOINT
 *
 * Examples:
 *   npm run photos:build-variants-from-r2 -- --dry-run --limit=2
 *   npm run photos:build-variants-from-r2 -- --album=20240803桌面
 *   npm run photos:build-variants-from-r2 -- --limit=5 --force
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const DERIVATIVE_SPECS = [
  { key: 'thumbnail', width: 360, webpQuality: 74 },
  { key: 'preview', width: 960, webpQuality: 78 },
  { key: 'large', width: 2160, webpQuality: 82 }
]

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
    dryRun: false,
    force: false,
    limit: null,
    album: null,
    concurrency: 2,
    help: false
  }
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
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

function publicUrl(cdn, key) {
  return `${cdn}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function encodeObjectPath(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

function basenameNoExt(filename) {
  return path.basename(filename, path.extname(filename)).toLowerCase()
}

function variantKey(album, filename, sizeKey) {
  return `photos/${album}/variants/${basenameNoExt(filename)}-${sizeKey}.webp`
}

function hasRealVariant(photo, sizeKey) {
  const originalSrc = photo?.variants?.original?.src
  const variant = photo?.variants?.[sizeKey]
  if (!variant?.src || !originalSrc) return false
  if (variant.src === originalSrc) return false
  if (!variant.width || !variant.height) return false
  return variant.src.includes('/variants/') && variant.src.endsWith(`-${sizeKey}.webp`)
}

function needsBuild(photo, force) {
  if (force) return true
  return !DERIVATIVE_SPECS.every((spec) => hasRealVariant(photo, spec.key))
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()))
  return results
}

async function downloadOriginal(photo, { cdn, accountId, apiToken, bucket }) {
  const key = photo.source?.bucketKey || photo.meta?.r2Key
  if (!key) throw new Error(`Missing source key for ${photo.id}`)

  // Prefer public CDN (simple); fall back to Cloudflare API.
  const cdnUrl = publicUrl(cdn, key)
  let response = await fetch(cdnUrl)
  if (!response.ok && accountId && apiToken) {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`
    response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${apiToken}` } })
  }
  if (!response.ok) {
    throw new Error(`Download failed ${response.status} for ${key}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 32) throw new Error(`Download too small for ${key}`)
  return { key, buffer }
}

async function generateDerivatives(imageBuffer) {
  const image = sharp(imageBuffer, { failOn: 'none', limitInputPixels: false }).rotate()
  const metadata = await image.metadata()
  const originalWidth = metadata.width
  const originalHeight = metadata.height
  if (!originalWidth || !originalHeight) {
    throw new Error('Unable to read image dimensions')
  }

  const variants = {
    original: {
      width: originalWidth,
      height: originalHeight,
      type: metadata.format ? `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}` : 'image/jpeg'
    }
  }

  for (const spec of DERIVATIVE_SPECS) {
    const targetWidth = Math.min(spec.width, originalWidth)
    const output = await sharp(imageBuffer, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: spec.webpQuality, effort: 4 })
      .toBuffer({ resolveWithObject: true })

    variants[spec.key] = {
      buffer: output.data,
      width: output.info.width,
      height: output.info.height,
      type: 'image/webp'
    }
  }

  return {
    ratio: originalWidth / originalHeight,
    variants
  }
}

async function headExistsViaApi({ accountId, apiToken, bucket, key }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Range: 'bytes=0-0'
    }
  })
  return response.ok || response.status === 206
}

async function uploadViaCloudflareApi({ accountId, apiToken, bucket, key, body, contentType, dryRun }) {
  if (dryRun) {
    console.log(`  [dry-run] put ${key} (${body.length} bytes)`)
    return
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(key)}`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    },
    body
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Upload failed ${response.status} for ${key}: ${text.slice(0, 240)}`)
  }
}

async function createS3ClientIfConfigured() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null)

  if (!accessKeyId || !secretAccessKey || !endpoint) return null

  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
  const client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  })
  return {
    async put({ bucket, key, body, contentType, dryRun }) {
      if (dryRun) {
        console.log(`  [dry-run] s3 put ${key} (${body.length} bytes)`)
        return
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable'
        })
      )
    },
    async exists({ bucket, key }) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch {
        return false
      }
    }
  }
}

function applyVariantsToPhoto(photo, { cdn, album, filename, ratio, generated }) {
  const originalKey = photo.source?.bucketKey || photo.meta?.r2Key
  const original = {
    src: photo.variants?.original?.src || publicUrl(cdn, originalKey),
    width: generated.variants.original.width,
    height: generated.variants.original.height,
    type: photo.variants?.original?.type || generated.variants.original.type
  }

  const nextVariants = { original }
  for (const spec of DERIVATIVE_SPECS) {
    const key = variantKey(album, filename, spec.key)
    const item = generated.variants[spec.key]
    nextVariants[spec.key] = {
      src: publicUrl(cdn, key),
      width: item.width,
      height: item.height,
      type: item.type
    }
  }

  return {
    ...photo,
    variants: nextVariants,
    meta: {
      ...photo.meta,
      ratio,
      album: photo.meta?.album || album,
      location: photo.meta?.location || album
    }
  }
}

async function main() {
  loadDotEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage:
  npm run photos:build-variants-from-r2 -- [options]

Options:
  --dry-run          Download + process, skip upload and json write
  --force            Rebuild even if variants look present
  --limit=N          Process at most N photos
  --album=NAME       Only one album folder name
  --concurrency=N    Parallel jobs (default 2)
`)
    return
  }

  const dataPath = path.resolve(repoRoot, process.env.PHOTOS_DATA_PATH || path.join('_data', 'photos.json'))
  const cdn = normalizeCdn(process.env.PHOTOS_CDN)
  const bucket = process.env.R2_BUCKET || 'bazinga-gallery'
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN

  if (!existsSync(dataPath)) {
    throw new Error(`Missing ${dataPath}. Run photos:sync-from-r2 first.`)
  }

  const photos = JSON.parse(readFileSync(dataPath, 'utf8'))
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new Error('photos.json is empty. Run photos:sync-from-r2 first.')
  }

  let candidates = photos.filter((photo) => needsBuild(photo, options.force))
  if (options.album) {
    candidates = candidates.filter((photo) => (photo.meta?.album || photo.source?.album) === options.album)
  }
  if (options.limit != null && Number.isFinite(options.limit)) {
    candidates = candidates.slice(0, options.limit)
  }

  console.log(
    `Photos total=${photos.length}; to process=${candidates.length}` +
      (options.album ? `; album=${options.album}` : '') +
      (options.dryRun ? '; dry-run' : '')
  )

  if (candidates.length === 0) {
    console.log('Nothing to do.')
    return
  }

  const s3 = await createS3ClientIfConfigured()
  const canUploadApi = Boolean(accountId && apiToken)
  if (!options.dryRun && !s3 && !canUploadApi) {
    throw new Error(
      'No upload credentials. Set CLOUDFLARE_API_TOKEN with R2 Edit, or R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY.'
    )
  }

  // Probe write permission once (skip dry-run).
  if (!options.dryRun && !s3 && canUploadApi) {
    const probeKey = `photos/.write-probe-${Date.now()}.txt`
    try {
      await uploadViaCloudflareApi({
        accountId,
        apiToken,
        bucket,
        key: probeKey,
        body: Buffer.from('ok'),
        contentType: 'text/plain',
        dryRun: false
      })
      // best-effort delete
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeObjectPath(probeKey)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } }
      )
    } catch (error) {
      throw new Error(
        `R2 upload not permitted with current API token (${error.message}). ` +
          'Create a token with Account → Workers R2 Storage → Edit, or use R2 S3 access keys.'
      )
    }
  }

  const byId = new Map(photos.map((photo) => [photo.id, photo]))
  let ok = 0
  let failed = 0

  await mapPool(candidates, options.concurrency, async (photo) => {
    const album = photo.source?.album || photo.meta?.album
    const filename = photo.source?.filename || path.basename(photo.source?.bucketKey || '')
    const label = `${album}/${filename}`
    try {
      process.stdout.write(`→ ${label}\n`)
      const { buffer } = await downloadOriginal(photo, { cdn, accountId, apiToken, bucket })
      const generated = await generateDerivatives(buffer)

      for (const spec of DERIVATIVE_SPECS) {
        const key = variantKey(album, filename, spec.key)
        const body = generated.variants[spec.key].buffer
        if (s3) {
          await s3.put({ bucket, key, body, contentType: 'image/webp', dryRun: options.dryRun })
        } else {
          await uploadViaCloudflareApi({
            accountId,
            apiToken,
            bucket,
            key,
            body,
            contentType: 'image/webp',
            dryRun: options.dryRun
          })
        }
      }

      const updated = applyVariantsToPhoto(photo, {
        cdn,
        album,
        filename,
        ratio: generated.ratio,
        generated
      })
      byId.set(photo.id, updated)
      ok += 1
      console.log(
        `  ok ${label} → ${generated.variants.preview.width}x${generated.variants.preview.height} preview`
      )
    } catch (error) {
      failed += 1
      console.error(`  fail ${label}: ${error.message || error}`)
    }
  })

  if (!options.dryRun && ok > 0) {
    const nextPhotos = photos.map((photo) => byId.get(photo.id) || photo)
    // Keep newest-first if uploaded present
    nextPhotos.sort((a, b) => {
      const ta = Date.parse(a.uploaded) || 0
      const tb = Date.parse(b.uploaded) || 0
      if (ta !== tb) return tb - ta
      return String(a.id).localeCompare(String(b.id))
    })
    writeFileSync(dataPath, `${JSON.stringify(nextPhotos, null, 2)}\n`)
    console.log(`Wrote ${dataPath}`)
  }

  console.log(`Done. ok=${ok} failed=${failed} dryRun=${options.dryRun}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
