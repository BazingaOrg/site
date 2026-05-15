import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const photosDataPath = path.join(repoRoot, '_data', 'photos.json')
const variantsDirectory = path.join(repoRoot, 'images', 'photos', 'variants')

const derivativeSpecs = [
  { key: 'thumbnail', width: 360, quality: 74 },
  { key: 'preview', width: 960, quality: 78 },
  { key: 'large', width: 2160, quality: 82 }
]

/**
 * Generates deployable photo derivatives while preserving the original asset as
 * the canonical source. The Jekyll templates should serve these derivatives by
 * default and keep the original only for metadata and archival access.
 */
async function main() {
  mkdirSync(variantsDirectory, { recursive: true })

  const photos = JSON.parse(readFileSync(photosDataPath, 'utf8'))
  const updatedPhotos = []

  for (const photo of photos) {
    const originalSource = resolveOriginalSource(photo)
    if (!originalSource) {
      updatedPhotos.push(photo)
      continue
    }

    const originalAbsolutePath = path.join(repoRoot, originalSource.replace(/^\//, ''))
    const originalImage = sharp(originalAbsolutePath, { failOn: 'none' })
    const originalMetadata = await originalImage.metadata()
    const originalWidth = originalMetadata.width
    const originalHeight = originalMetadata.height

    if (!originalWidth || !originalHeight) {
      throw new Error(`Unable to read dimensions for ${originalSource}`)
    }

    const generatedVariants = {}
    const baseName = path.basename(originalSource, path.extname(originalSource)).toLowerCase()

    for (const spec of derivativeSpecs) {
      const outputFileName = `${baseName}-${spec.key}.webp`
      const outputAbsolutePath = path.join(variantsDirectory, outputFileName)
      const outputPublicPath = `/images/photos/variants/${outputFileName}`
      const info = await sharp(originalAbsolutePath, { failOn: 'none' })
        .resize({
          width: Math.min(spec.width, originalWidth),
          withoutEnlargement: true
        })
        .webp({
          quality: spec.quality,
          effort: 5
        })
        .toFile(outputAbsolutePath)

      generatedVariants[spec.key] = {
        src: outputPublicPath,
        width: info.width,
        height: info.height,
        type: 'image/webp'
      }
    }

    updatedPhotos.push({
      ...photo,
      variants: {
        original: {
          src: originalSource,
          width: originalWidth,
          height: originalHeight,
          type: originalMetadata.format ? `image/${normalizeFormat(originalMetadata.format)}` : undefined
        },
        ...generatedVariants
      },
      meta: {
        ...photo.meta,
        ratio: originalWidth / originalHeight
      }
    })

    console.log(`Generated variants for ${photo.id}`)
  }

  writeFileSync(photosDataPath, `${JSON.stringify(updatedPhotos, null, 2)}\n`)
  console.log(`Updated ${photosDataPath}`)
}

function resolveOriginalSource(photo) {
  if (Array.isArray(photo?.variants)) {
    return photo.variants[0] || null
  }

  const original = photo?.variants?.original
  if (typeof original === 'string') return original

  return original?.src || null
}

function normalizeFormat(format) {
  return format === 'jpg' ? 'jpeg' : format
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
