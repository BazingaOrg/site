import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const photosDataPath = path.join(repoRoot, '_data', 'photos.json')

/**
 * Keep EXIF extraction in a local script so the frontend stays simple and predictable.
 * The site only needs a small set of human-readable photography details, not raw EXIF.
 */
function main() {
  const photos = JSON.parse(readFileSync(photosDataPath, 'utf8'))
  const photoFiles = photos
    .map((photo) => {
      const imagePath = resolveOriginalSource(photo)
      if (!imagePath) return null

      return {
        photo,
        absolutePath: path.join(repoRoot, imagePath.replace(/^\//, ''))
      }
    })
    .filter(Boolean)

  const exifResult = spawnSync(
    'exiftool',
    [
      '-json',
      '-Model',
      '-LensModel',
      '-FNumber',
      '-ExposureTime',
      '-ISO',
      '-FocalLength',
      '-DateTimeOriginal',
      ...photoFiles.map(({ absolutePath }) => absolutePath)
    ],
    { encoding: 'utf8' }
  )

  if (exifResult.error) {
    throw exifResult.error
  }

  if (exifResult.status !== 0) {
    throw new Error(exifResult.stderr || 'Failed to read EXIF metadata with exiftool')
  }

  const exifEntries = JSON.parse(exifResult.stdout)
  const exifBySourceFile = new Map(
    exifEntries.map((entry) => [path.resolve(entry.SourceFile), formatExif(entry)])
  )

  const updatedPhotos = photos.map((photo) => {
    const imagePath = resolveOriginalSource(photo)
    if (!imagePath) return photo

    const absolutePath = path.join(repoRoot, imagePath.replace(/^\//, ''))
    const formattedExif = exifBySourceFile.get(path.resolve(absolutePath))
    const nextMeta = { ...photo.meta }
    const sourceFormat = deriveSourceFormat(imagePath)
    const hdrCandidate = isHdrCandidate(sourceFormat)

    if (formattedExif) {
      nextMeta.exif = formattedExif
    } else {
      delete nextMeta.exif
    }

    nextMeta.sourceFormat = sourceFormat
    nextMeta.dynamicRange = hdrCandidate ? 'hdr-candidate' : 'sdr'
    nextMeta.hdrCandidate = hdrCandidate
    nextMeta.assetPolicy = 'preserve-original'
    nextMeta.fallbackStrategy = 'none'
    nextMeta.fallbackGenerated = false

    return {
      ...photo,
      meta: nextMeta
    }
  })

  writeFileSync(photosDataPath, `${JSON.stringify(updatedPhotos, null, 2)}\n`)
  console.log(`Updated EXIF metadata for ${updatedPhotos.length} photos.`)
}

function formatExif(entry) {
  const camera = cleanText(entry.Model)
  const lens = cleanText(entry.LensModel)
  const aperture = formatAperture(entry.FNumber)
  const shutter = formatShutter(entry.ExposureTime)
  const iso = formatIso(entry.ISO)
  const focalLength = formatFocalLength(entry.FocalLength)
  const capturedAt = formatCapturedAt(entry.DateTimeOriginal)

  const exif = {
    ...(camera ? { camera } : {}),
    ...(lens ? { lens } : {}),
    ...(focalLength ? { focalLength } : {}),
    ...(aperture ? { aperture } : {}),
    ...(shutter ? { shutter } : {}),
    ...(iso ? { iso } : {}),
    ...(capturedAt ? { capturedAt } : {})
  }

  return Object.keys(exif).length > 0 ? exif : null
}

function cleanText(value) {
  if (value == null) return null
  const text = `${value}`.trim()
  return text || null
}

function stripTrailingDecimal(text) {
  return text.replace(/(\.\d*?[1-9])0+(?=[^\d]|$)/g, '$1').replace(/\.0+(?=[^\d]|$)/g, '')
}

function formatAperture(value) {
  const text = cleanText(value)
  return text ? `f/${stripTrailingDecimal(text)}` : null
}

function formatShutter(value) {
  const text = cleanText(value)
  if (!text) return null
  return text.endsWith('s') ? text : `${text}s`
}

function formatIso(value) {
  const text = cleanText(value)
  return text ? `ISO ${stripTrailingDecimal(text)}` : null
}

function formatFocalLength(value) {
  const text = cleanText(value)
  if (!text) return null
  return stripTrailingDecimal(text.replace(/\s+/g, ''))
}

function formatCapturedAt(value) {
  const text = cleanText(value)
  if (!text) return null

  const match = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/)
  if (!match) return text

  const [, year, month, day, hour, minute] = match
  return `${year}/${month}/${day} ${hour}:${minute}`
}

function deriveSourceFormat(imagePath) {
  const extensionMatch = imagePath.toLowerCase().match(/\.([a-z0-9]+)$/)
  return extensionMatch?.[1] || 'jpg'
}

function isHdrCandidate(sourceFormat) {
  return ['avif', 'heic', 'heif', 'jxl'].includes(sourceFormat)
}

function resolveOriginalSource(photo) {
  if (Array.isArray(photo?.variants)) {
    return photo.variants[0] || null
  }

  const original = photo?.variants?.original
  if (typeof original === 'string') return original

  return original?.src || null
}

main()
