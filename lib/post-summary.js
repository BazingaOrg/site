const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1'
const CHINESE_LONG_FORM_CHAR_THRESHOLD = 600
const LONG_FORM_LINE_THRESHOLD = 12
const SUMMARY_SENTENCE_MIN = 2
const SUMMARY_SENTENCE_MAX = 4
const SUMMARY_CHINESE_CHAR_MIN = 50
const SUMMARY_CHINESE_CHAR_MAX = 180
const SUMMARY_ENGLISH_WORD_MIN = 35
const SUMMARY_ENGLISH_WORD_MAX = 100

const DISALLOWED_PATTERNS = [
  /(?:^|[\s，。；,.;:])本文介绍了/u,
  /(?:^|[\s，。；,.;:])这篇文章/u,
  /(?:^|[\s，。；,.;:])作者分享了/u,
  /\bThis article\b/i,
  /\bIn this post\b/i,
  /\bThe author\b/i
]

export function normalizePostLanguage(lang, body = '') {
  if (typeof lang === 'string' && lang.trim()) {
    return lang.trim()
  }

  return /[\u4e00-\u9fff]/u.test(body) ? 'zh-CN' : 'en-US'
}

export function sanitizeSummaryText(summary) {
  if (typeof summary !== 'string') return ''

  return summary
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function countMeaningfulLines(body) {
  return String(body || '')
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0)
    .length
}

export function countChineseCharacters(body) {
  const matches = String(body || '').match(/[\u4e00-\u9fff]/gu)
  return matches ? matches.length : 0
}

export function isChineseContent(lang, body = '') {
  const normalizedLang = normalizePostLanguage(lang, body).toLowerCase()
  return normalizedLang.startsWith('zh')
}

export function isLongFormPost(body, lang) {
  const lines = countMeaningfulLines(body)
  if (lines >= LONG_FORM_LINE_THRESHOLD) {
    return true
  }

  if (isChineseContent(lang, body)) {
    return countChineseCharacters(body) >= CHINESE_LONG_FORM_CHAR_THRESHOLD
  }

  return String(body || '').trim().split(/\s+/).filter(Boolean).length >= 180
}

export function getLongFormGuidance(lang, body) {
  if (isLongFormPost(body, lang)) {
    return {
      eligible: true,
      reason: null
    }
  }

  return {
    eligible: false,
    reason: 'AI summary is only generated for longer posts. Add more detail or write the summary manually.'
  }
}

export function buildSummaryMessages({ title, body, lang }) {
  const normalizedLang = normalizePostLanguage(lang, body)

  return {
    system: `You write short publish-ready summaries for a minimalist personal blog.

Your job is to help readers quickly understand the main thread of a long-form post before they start reading.

Write with a calm, precise, understated tone.
Do not sound promotional, corporate, journalistic, or like a content platform.
Do not force the post into a fixed content type such as guide, essay, diary, or opinion piece.

Focus on:
- what the post is mainly about
- one concrete detail, insight, or takeaway worth knowing early
- why the post is worth continuing to read

Requirements:
- Write in the same language as the post.
- Output plain text only.
- Write 2 to 4 sentences.
- For Chinese posts, aim for about 70 to 140 Chinese characters.
- For English posts, aim for about 40 to 90 words.
- Keep the wording natural and compact.
- Preserve ambiguity if the post is exploratory; do not over-clarify beyond the source material.

Do not:
- use bullet points
- use Markdown or HTML
- use quotation marks unless necessary
- say "This article", "In this post", "The author", "本文", "这篇文章", "作者分享了", or similar meta phrasing
- exaggerate or use clickbait language
- invent facts, structure, or conclusions not supported by the post
- repeat the title unless necessary for clarity

Return only the summary text.`,
    user: `Title:
${title}

Language:
${normalizedLang}

Post body:
${body}`
  }
}

function buildRefineMessages({ draftSummary, lang }) {
  return {
    system: `Rewrite the summary below so it reads like a short preface for a minimalist personal blog post.

Rules:
- Keep the original meaning.
- Make it more natural, concrete, and compact.
- Remove generic or meta phrasing.
- Do not force the post into a category.
- Keep the same language.
- Keep it within 2 to 4 sentences.
- Output plain text only.`,
    user: `Language:
${lang}

Summary:
${draftSummary}`
  }
}

export function validateSummary(summary, { title, lang, body = '' } = {}) {
  const normalizedSummary = sanitizeSummaryText(summary)
  if (!normalizedSummary) {
    return { valid: false, reason: 'Summary is empty.' }
  }

  if (/[<>*_`]/.test(normalizedSummary)) {
    return { valid: false, reason: 'Summary must be plain text only.' }
  }

  if (/^\s*[-*+]\s/u.test(normalizedSummary)) {
    return { valid: false, reason: 'Summary cannot be a list.' }
  }

  if (DISALLOWED_PATTERNS.some(pattern => pattern.test(normalizedSummary))) {
    return { valid: false, reason: 'Summary uses generic meta phrasing.' }
  }

  const sentenceCount = normalizedSummary
    .split(/(?<=[。！？!?])\s*|(?<=[.?!])\s+(?=[A-Z0-9"\u4e00-\u9fff])/u)
    .map(part => part.trim())
    .filter(Boolean)
    .length

  if (sentenceCount < SUMMARY_SENTENCE_MIN || sentenceCount > SUMMARY_SENTENCE_MAX) {
    return {
      valid: false,
      reason: `Summary should be ${SUMMARY_SENTENCE_MIN} to ${SUMMARY_SENTENCE_MAX} sentences.`
    }
  }

  const chinese = isChineseContent(lang, body)
  if (chinese) {
    const characterCount = countChineseCharacters(normalizedSummary)
    if (characterCount < SUMMARY_CHINESE_CHAR_MIN || characterCount > SUMMARY_CHINESE_CHAR_MAX) {
      return {
        valid: false,
        reason: `Chinese summary should be about ${SUMMARY_CHINESE_CHAR_MIN} to ${SUMMARY_CHINESE_CHAR_MAX} characters.`
      }
    }
  } else {
    const wordCount = normalizedSummary.split(/\s+/).filter(Boolean).length
    if (wordCount < SUMMARY_ENGLISH_WORD_MIN || wordCount > SUMMARY_ENGLISH_WORD_MAX) {
      return {
        valid: false,
        reason: `English summary should be about ${SUMMARY_ENGLISH_WORD_MIN} to ${SUMMARY_ENGLISH_WORD_MAX} words.`
      }
    }
  }

  const normalizedTitle = String(title || '').trim().toLowerCase()
  if (normalizedTitle) {
    const normalizedTitleWords = normalizedTitle.split(/\s+/).filter(Boolean)
    const repeatsTitle = normalizedTitleWords.length > 0 && normalizedTitleWords.every(word => normalizedSummary.toLowerCase().includes(word))
    const summaryAddsDetail = normalizedSummary.replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, '').length > normalizedTitle.replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, '').length + 12

    if (repeatsTitle && !summaryAddsDetail) {
      return { valid: false, reason: 'Summary mostly repeats the title without adding detail.' }
    }
  }

  return { valid: true, reason: null }
}

export async function generatePostSummary({ title, body, lang, apiKey, model, baseUrl }) {
  const normalizedLang = normalizePostLanguage(lang, body)
  const { eligible, reason } = getLongFormGuidance(normalizedLang, body)
  if (!eligible) {
    throw new Error(reason)
  }

  if (!apiKey || !model) {
    throw new Error('LLM_API_KEY and LLM_MODEL are required to generate AI summaries.')
  }

  const endpointBase = (baseUrl || DEFAULT_LLM_BASE_URL).replace(/\/+$/, '')
  const initialMessages = buildSummaryMessages({ title, body, lang: normalizedLang })
  const initialSummary = sanitizeSummaryText(await requestChatCompletion({
    apiKey,
    model,
    baseUrl: endpointBase,
    messages: initialMessages
  }))

  let validation = validateSummary(initialSummary, { title, lang: normalizedLang, body })
  if (validation.valid) {
    return { summary: initialSummary, refined: false }
  }

  const refinedMessages = buildRefineMessages({
    draftSummary: initialSummary,
    lang: normalizedLang
  })
  const refinedSummary = sanitizeSummaryText(await requestChatCompletion({
    apiKey,
    model,
    baseUrl: endpointBase,
    messages: refinedMessages
  }))

  validation = validateSummary(refinedSummary, { title, lang: normalizedLang, body })
  if (!validation.valid) {
    throw new Error(validation.reason || 'Generated summary did not pass validation.')
  }

  return { summary: refinedSummary, refined: true }
}

async function requestChatCompletion({ apiKey, model, baseUrl, messages }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user }
      ]
    })
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new Error(errorBody?.error?.message || errorBody?.message || 'Failed to generate AI summary.')
  }

  const payload = await response.json()
  const summary = payload?.choices?.[0]?.message?.content
  if (!summary || typeof summary !== 'string') {
    throw new Error('LLM response did not include a text summary.')
  }

  return summary
}
