import {
  generatePostSummary,
  getLongFormGuidance,
  normalizePostLanguage
} from '../lib/post-summary.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Key')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST 请求' })
    return
  }

  const { WRITE_ACCESS_KEY, LLM_API_KEY, LLM_MODEL, LLM_BASE_URL } = process.env

  if (!WRITE_ACCESS_KEY) {
    res.status(500).json({ error: '服务器配置错误' })
    return
  }

  const accessKey = req.headers['x-access-key']
  if (!accessKey || accessKey !== WRITE_ACCESS_KEY) {
    res.status(401).json({ error: '无效的访问密钥' })
    return
  }

  if (!LLM_API_KEY || !LLM_MODEL) {
    res.status(500).json({ error: 'LLM summary generation is not configured on the server.' })
    return
  }

  const { title, body, lang } = req.body || {}
  if (!title || !String(title).trim()) {
    res.status(400).json({ error: '生成总结前需要先填写标题' })
    return
  }

  if (!body || !String(body).trim()) {
    res.status(400).json({ error: '生成总结前需要先填写正文' })
    return
  }

  const normalizedLang = normalizePostLanguage(lang, body)
  const longForm = getLongFormGuidance(normalizedLang, body)
  if (!longForm.eligible) {
    res.status(400).json({ error: longForm.reason })
    return
  }

  try {
    const result = await generatePostSummary({
      title: String(title).trim(),
      body: String(body).trim(),
      lang: normalizedLang,
      apiKey: LLM_API_KEY,
      model: LLM_MODEL,
      baseUrl: LLM_BASE_URL
    })

    res.status(200).json({
      summary: result.summary,
      refined: result.refined
    })
  } catch (error) {
    console.error('生成 AI 总结失败:', error)
    res.status(500).json({
      error: error.message || '生成 AI 总结失败，请稍后重试'
    })
  }
}
