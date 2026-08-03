import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(__dirname, '..', '..')

export const DEFAULT_CDN = 'https://img.bazinga.ink'
export const DEFAULT_BUCKET = 'bazinga-gallery'

export function loadDotEnv(root = repoRoot) {
  const envPath = path.join(root, '.env')
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

export function normalizeCdn(cdn = process.env.PHOTOS_CDN) {
  return (cdn || DEFAULT_CDN).replace(/\/$/, '')
}

export function encodeObjectPath(key) {
  return key.split('/').map(encodeURIComponent).join('/')
}

export function publicCdnUrl(cdn, key) {
  return `${normalizeCdn(cdn)}/${encodeObjectPath(key)}`
}

export async function mapPool(items, concurrency, worker) {
  if (items.length === 0) return []
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length)
  await Promise.all(Array.from({ length: n }, () => run()))
  return results
}

export function sortPhotosNewestFirst(photos) {
  return [...photos].sort((a, b) => {
    const ta = Date.parse(a.uploaded) || 0
    const tb = Date.parse(b.uploaded) || 0
    if (ta !== tb) return tb - ta
    return String(a.id).localeCompare(String(b.id))
  })
}
