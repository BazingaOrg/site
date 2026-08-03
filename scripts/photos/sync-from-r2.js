import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

/**
 * List objects under R2: photos/{album}/{filename}
 * and write _data/photos.json with CDN URLs under https://img.bazinga.ink
 *
 * Auth (pick one):
 *   1) CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN  (Account API token with R2 read)
 *   2) Local listing file via --from-list=path (one object key per line)
 *
 * Env (optional):
 *   R2_BUCKET=bazinga-gallery
 *   PHOTOS_CDN=https://img.bazinga.ink
 *   PHOTOS_PREFIX=photos/
 *   PHOTOS_DATA_PATH=_data/photos.json
 */

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.gif',
  '.tif',
  '.tiff',
  '.heic',
  '.heif'
])

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif'
}

function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env')
  if (!existsSync(envPath)) return
  const text = readFileSync(envPath, 'utf8')
  for (const rawLine of text.split('\n')) {
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
    fromList: null,
    dryRun: false,
    prefix: null,
    bucket: null,
    cdn: null
  }
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg.startsWith('--from-list=')) options.fromList = arg.slice('--from-list='.length)
    else if (arg.startsWith('--prefix=')) options.prefix = arg.slice('--prefix='.length)
    else if (arg.startsWith('--bucket=')) options.bucket = arg.slice('--bucket='.length)
    else if (arg.startsWith('--cdn=')) options.cdn = arg.slice('--cdn='.length)
    else if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

function normalizePrefix(prefix) {
  if (!prefix) return 'photos/'
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

function normalizeCdn(cdn) {
  return (cdn || 'https://img.bazinga.ink').replace(/\/$/, '')
}

function slugify(value) {
  // Keep letters/numbers from any language (e.g. 黄山), collapse other runs to '-'.
  const slug = String(value)
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80)
  return slug || 'item'
}

function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 8)
}

function isImageKey(key) {
  const ext = path.extname(key).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

/**
 * Expected layout: photos/{album}/{file}
 * Ignores deeper nesting and files directly under photos/.
 */
function parseAlbumObject(key, prefix) {
  if (!key.startsWith(prefix)) return null
  if (key.endsWith('/')) return null
  if (!isImageKey(key)) return null

  const relative = key.slice(prefix.length)
  const parts = relative.split('/').filter(Boolean)
  if (parts.length !== 2) return null

  const [album, filename] = parts
  if (!album || !filename || filename.startsWith('.')) return null

  return { album, filename, key }
}

function publicUrl(cdn, key) {
  const encoded = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${cdn}/${encoded}`
}

function mimeForKey(key) {
  return MIME_BY_EXT[path.extname(key).toLowerCase()] || 'application/octet-stream'
}

function variantSet(src, type) {
  const base = { src, type }
  return {
    original: { ...base },
    thumbnail: { ...base },
    preview: { ...base },
    large: { ...base }
  }
}

function loadExistingPhotos(dataPath) {
  if (!existsSync(dataPath)) return []
  try {
    const parsed = JSON.parse(readFileSync(dataPath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function indexExisting(photos) {
  const byKey = new Map()
  const byId = new Map()
  for (const photo of photos) {
    if (photo?.id) byId.set(photo.id, photo)
    const key = photo?.source?.key || photo?.meta?.r2Key
    if (key) byKey.set(key, photo)
    const originalSrc = photo?.variants?.original?.src
    if (typeof originalSrc === 'string') {
      try {
        const url = new URL(originalSrc)
        const maybeKey = decodeURIComponent(url.pathname.replace(/^\//, ''))
        byKey.set(maybeKey, photo)
      } catch {
        // ignore invalid URL
      }
    }
  }
  return { byKey, byId }
}

function mergeMeta(existing, album, filename, key) {
  const previous = existing?.meta || {}
  const defaultAlt = previous.alt || `${album} / ${filename}`
  const next = {
    ...previous,
    alt: defaultAlt,
    location: previous.location || album,
    album,
    r2Key: key,
    sourceFormat: path.extname(filename).slice(1).toLowerCase() || previous.sourceFormat,
    dynamicRange: previous.dynamicRange || 'sdr',
    hdrCandidate: previous.hdrCandidate === true,
    assetPolicy: previous.assetPolicy || 'r2-original',
    fallbackStrategy: previous.fallbackStrategy || 'none',
    fallbackGenerated: previous.fallbackGenerated === true
  }

  // Only keep a real ratio from prior builds; never invent a placeholder (e.g. 1.5).
  if (typeof previous.ratio === 'number' && Number.isFinite(previous.ratio) && previous.ratio > 0) {
    next.ratio = previous.ratio
  } else {
    delete next.ratio
  }

  return next
}

function buildPhotoRecord({ album, filename, key, lastModified, cdn, existing }) {
  const idSeed = `${album}/${filename}`
  const id =
    existing?.id ||
    `photo-${slugify(album)}-${slugify(path.parse(filename).name)}-${shortHash(idSeed)}`
  const src = publicUrl(cdn, key)
  const type = mimeForKey(key)
  const uploaded =
    existing?.uploaded ||
    (lastModified ? new Date(lastModified).toISOString() : new Date().toISOString())

  return {
    id,
    uploaded,
    source: {
      bucketKey: key,
      album,
      filename
    },
    variants: variantSet(src, type),
    meta: mergeMeta(existing, album, filename, key)
  }
}

async function listObjectsViaCloudflareApi({ accountId, apiToken, bucket, prefix }) {
  const objects = []
  let cursor = null

  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`
    )
    url.searchParams.set('prefix', prefix)
    url.searchParams.set('per_page', '1000')
    if (cursor) url.searchParams.set('cursor', cursor)

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.success === false) {
      const message =
        payload?.errors?.map((e) => e.message).join('; ') ||
        payload?.messages?.join('; ') ||
        `${response.status} ${response.statusText}`
      throw new Error(`Cloudflare R2 list failed: ${message}`)
    }

    const result = payload.result
    const batch = Array.isArray(result)
      ? result
      : Array.isArray(result?.objects)
        ? result.objects
        : Array.isArray(result?.items)
          ? result.items
          : []

    for (const item of batch) {
      const key = item.key || item.name || item.Key
      if (!key) continue
      objects.push({
        key,
        lastModified: item.last_modified || item.lastModified || item.uploaded || item.LastModified || null,
        size: item.size ?? item.Size ?? null
      })
    }

    cursor =
      payload.result_info?.cursor ||
      payload.result?.cursor ||
      (payload.result_info?.is_truncated ? payload.result_info?.cursor : null) ||
      null

    // Some API shapes use truncated + cursor_token
    if (!cursor && payload.result_info?.is_truncated && payload.result_info?.cursor_token) {
      cursor = payload.result_info.cursor_token
    }
  } while (cursor)

  return objects
}

function listObjectsFromFile(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath)
  const text = readFileSync(absolute, 'utf8')
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((key) => ({ key, lastModified: null, size: null }))
}

async function main() {
  loadDotEnv()
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    console.log(`Usage:
  npm run photos:sync-from-r2
  npm run photos:sync-from-r2 -- --dry-run
  npm run photos:sync-from-r2 -- --from-list=tmp/r2-keys.txt

Requires either:
  CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
or:
  --from-list with one object key per line (e.g. photos/黄山/DSCF0978.jpg)
`)
    return
  }

  const bucket = options.bucket || process.env.R2_BUCKET || 'bazinga-gallery'
  const prefix = normalizePrefix(options.prefix || process.env.PHOTOS_PREFIX || 'photos/')
  const cdn = normalizeCdn(options.cdn || process.env.PHOTOS_CDN || 'https://img.bazinga.ink')
  const dataPath = path.resolve(
    repoRoot,
    process.env.PHOTOS_DATA_PATH || path.join('_data', 'photos.json')
  )

  let rawObjects
  if (options.fromList) {
    rawObjects = listObjectsFromFile(options.fromList)
    console.log(`Loaded ${rawObjects.length} keys from ${options.fromList}`)
  } else {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID
    const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
    if (!accountId || !apiToken) {
      throw new Error(
        'Missing credentials. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env, or pass --from-list=file.txt'
      )
    }
    console.log(`Listing r2://${bucket}/${prefix} …`)
    rawObjects = await listObjectsViaCloudflareApi({
      accountId,
      apiToken,
      bucket,
      prefix
    })
    console.log(`API returned ${rawObjects.length} objects`)
  }

  const existingPhotos = loadExistingPhotos(dataPath)
  const { byKey } = indexExisting(existingPhotos)

  const photos = []
  const skipped = []
  for (const object of rawObjects) {
    const parsed = parseAlbumObject(object.key, prefix)
    if (!parsed) {
      skipped.push(object.key)
      continue
    }
    const existing = byKey.get(parsed.key)
    photos.push(
      buildPhotoRecord({
        album: parsed.album,
        filename: parsed.filename,
        key: parsed.key,
        lastModified: object.lastModified,
        cdn,
        existing
      })
    )
  }

  photos.sort((a, b) => {
    const ta = Date.parse(a.uploaded) || 0
    const tb = Date.parse(b.uploaded) || 0
    if (ta !== tb) return tb - ta
    return a.id.localeCompare(b.id)
  })

  const albums = new Set(photos.map((p) => p.meta.album))
  console.log(
    `Matched ${photos.length} photos in ${albums.size} albums (skipped ${skipped.length} non-album keys)`
  )
  if (skipped.length && skipped.length <= 20) {
    for (const key of skipped) console.log(`  skip: ${key}`)
  } else if (skipped.length > 20) {
    for (const key of skipped.slice(0, 10)) console.log(`  skip: ${key}`)
    console.log(`  … and ${skipped.length - 10} more`)
  }

  if (options.dryRun) {
    console.log('Dry run only — photos.json not written')
    console.log(JSON.stringify(photos.slice(0, 2), null, 2))
    return
  }

  writeFileSync(dataPath, `${JSON.stringify(photos, null, 2)}\n`)
  console.log(`Wrote ${photos.length} entries → ${path.relative(repoRoot, dataPath)}`)
  console.log(`CDN base: ${cdn}`)
  console.log('Note: without local variants, thumbnail/preview/large currently point at the original URL.')
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
