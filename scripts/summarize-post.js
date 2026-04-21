import fs from 'node:fs/promises'
import path from 'node:path'

import {
  generatePostSummary,
  getLongFormGuidance,
  normalizePostLanguage,
  sanitizeSummaryText
} from '../lib/post-summary.js'

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!options.file && !options.allMissing) {
    throw new Error('Use --file <post-path> or --all-missing.')
  }

  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  const baseUrl = process.env.LLM_BASE_URL

  if (!apiKey || !model) {
    throw new Error('LLM_API_KEY and LLM_MODEL must be set before running summarize:post.')
  }

  const targetFiles = options.allMissing
    ? await collectPostFiles()
    : [path.resolve(process.cwd(), options.file)]

  for (const filePath of targetFiles) {
    const result = await summarizeFile(filePath, { ...options, apiKey, model, baseUrl })
    process.stdout.write(`${result}\n`)
  }
}

async function summarizeFile(filePath, options) {
  const source = await fs.readFile(filePath, 'utf8')
  const parsed = parseMarkdownFile(source)
  const normalizedLang = normalizePostLanguage(parsed.frontMatter.lang, parsed.body)
  const summary = sanitizeSummaryText(parsed.frontMatter.ai_summary || '')
  const longForm = getLongFormGuidance(normalizedLang, parsed.body)

  if (!options.force && summary) {
    return `Skipped ${path.basename(filePath)}: ai_summary already exists.`
  }

  if (!longForm.eligible) {
    return `Skipped ${path.basename(filePath)}: ${longForm.reason}`
  }

  const { summary: generatedSummary, refined } = await generatePostSummary({
    title: parsed.frontMatter.title || path.basename(filePath),
    body: parsed.body,
    lang: normalizedLang,
    apiKey: options.apiKey,
    model: options.model,
    baseUrl: options.baseUrl
  })

  const nextContent = serializeMarkdownFile({
    frontMatter: {
      ...parsed.frontMatter,
      ai_summary: generatedSummary
    },
    body: parsed.body
  })
  await fs.writeFile(filePath, nextContent, 'utf8')

  return `Updated ${path.basename(filePath)} with AI summary${refined ? ' (refined)' : ''}.`
}

async function collectPostFiles() {
  const postsDirectory = path.resolve(process.cwd(), '_posts')
  const entries = await fs.readdir(postsDirectory)
  return entries
    .filter(entry => entry.endsWith('.md'))
    .sort()
    .map(entry => path.join(postsDirectory, entry))
}

function parseArguments(args) {
  const options = {
    file: null,
    allMissing: false,
    force: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--file') {
      options.file = args[index + 1]
      index += 1
      continue
    }

    if (argument === '--all-missing') {
      options.allMissing = true
      continue
    }

    if (argument === '--force') {
      options.force = true
      continue
    }
  }

  return options
}

function parseMarkdownFile(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    throw new Error('The post does not contain valid front matter.')
  }

  const [, rawFrontMatter, body] = match
  const frontMatter = {}

  for (const line of rawFrontMatter.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    frontMatter[key] = stripWrappingQuotes(rawValue)
  }

  return {
    frontMatter,
    body: body.trim()
  }
}

function serializeMarkdownFile({ frontMatter, body }) {
  const lines = ['---']

  for (const [key, value] of Object.entries(frontMatter)) {
    if (value == null || value === '') continue

    if (shouldQuoteFrontMatterValue(key, value)) {
      lines.push(`${key}: "${escapeYAML(String(value))}"`)
      continue
    }

    lines.push(`${key}: ${value}`)
  }

  lines.push('---', '', body.trim(), '')
  return lines.join('\n')
}

function shouldQuoteFrontMatterValue(key, value) {
  if (key === 'title' || key === 'image_text' || key === 'slug' || key === 'ai_summary') {
    return true
  }

  return typeof value === 'string' && /\s/.test(value) && !/^\[.*\]$/.test(value) && !/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(value)
}

function stripWrappingQuotes(value) {
  return String(value || '')
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\"/g, '"')
}

function escapeYAML(value) {
  return value.replace(/"/g, '\\"')
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
