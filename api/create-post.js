import {
  isLongFormPost,
  normalizePostLanguage,
  sanitizeSummaryText
} from '../lib/post-summary.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Key');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST 请求' });
    return;
  }

  const { GITHUB_TOKEN, GITHUB_REPO, WRITE_ACCESS_KEY } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_REPO || !WRITE_ACCESS_KEY) {
    console.error('缺少必要的环境变量:', {
      hasToken: !!GITHUB_TOKEN,
      hasRepo: !!GITHUB_REPO,
      hasKey: !!WRITE_ACCESS_KEY
    });
    res.status(500).json({ error: '服务器配置错误' });
    return;
  }

  const accessKey = req.headers['x-access-key'];
  if (!accessKey || accessKey !== WRITE_ACCESS_KEY) {
    res.status(401).json({ error: '无效的访问密钥' });
    return;
  }

  const {
    title,
    body,
    slug: providedSlug,
    lang = 'zh-CN',
    feature,
    image,
    image_text: imageText,
    ai_summary: providedSummary,
    date,
    filename: providedFilename
  } = req.body || {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: '标题不能为空' });
    return;
  }

  if (!body || !String(body).trim()) {
    res.status(400).json({ error: '正文不能为空' });
    return;
  }

  const cleanedSlug = generateSlug(providedSlug || title);
  const normalizedLang = normalizePostLanguage(lang, body);
  const shouldFeature = feature === 1 || feature === '1' || feature === true;
  const publishInfo = buildPublishInfo(date);
  const aiSummary = sanitizeSummaryText(providedSummary);

  if (isLongFormPost(body, normalizedLang) && !aiSummary) {
    res.status(400).json({ error: '长文发布前需要先生成或填写 AI 总结' });
    return;
  }

  const markdown = createMarkdown({
    title: String(title).trim(),
    body: String(body).trim(),
    slug: cleanedSlug,
    lang: normalizedLang,
    feature: shouldFeature,
    image,
    imageText,
    aiSummary,
    date: publishInfo.frontMatter
  });

  const filenameStem = `${publishInfo.filenameBase}-${cleanedSlug}`;
  const fallbackFilename = `${filenameStem}.md`;
  const filename = isValidFilename(providedFilename)
    ? providedFilename
    : fallbackFilename;
  const filepath = `_posts/${filename}`;

  try {
    const commitResult = await commitToGitHub({
      token: GITHUB_TOKEN,
      repo: GITHUB_REPO,
      filepath,
      content: markdown,
      message: `feat: Add post ${filenameStem}`
    });

    const responseFilename = commitResult?.content?.path
      ? commitResult.content.path.split('/').pop()
      : filename;

    const postUrl = `/posts/${cleanedSlug}/`;

    res.status(200).json({
      success: true,
      url: postUrl,
      filename: responseFilename,
      commit: commitResult?.commit?.sha || commitResult?.sha
    });
  } catch (error) {
    console.error('创建文章失败:', error);

    if (error.status === 422) {
      res.status(400).json({ error: '文件已存在或路径无效' });
      return;
    }

    if (error.status === 403) {
      res.status(403).json({ error: 'GitHub 权限不足，请检查 token 权限' });
      return;
    }

    res.status(500).json({
      error: '服务器错误，请稍后重试',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

function buildPublishInfo(providedDate) {
  const pattern = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/;
  let baseDate;
  let frontMatter;

  if (typeof providedDate === 'string' && pattern.test(providedDate)) {
    const [, year, month, day, hour, minute] = pattern.exec(providedDate);
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+08:00`);
    if (!Number.isNaN(parsed.getTime())) {
      baseDate = parsed;
      frontMatter = providedDate;
    }
  }

  if (!baseDate) {
    baseDate = computeShanghaiDate();
    const y = String(baseDate.getFullYear());
    const m = String(baseDate.getMonth() + 1).padStart(2, '0');
    const d = String(baseDate.getDate()).padStart(2, '0');
    const h = String(baseDate.getHours()).padStart(2, '0');
    const min = String(baseDate.getMinutes()).padStart(2, '0');
    frontMatter = `${y}/${m}/${d} ${h}:${min}`;
  }

  const year = String(baseDate.getFullYear());
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  const day = String(baseDate.getDate()).padStart(2, '0');
  const hour = String(baseDate.getHours()).padStart(2, '0');
  const minute = String(baseDate.getMinutes()).padStart(2, '0');
  const timeSegment = `${hour}${minute}`;

  return {
    frontMatter,
    filenameBase: `${year}-${month}-${day}-${timeSegment}-post`,
    iso: `${year}-${month}-${day}T${hour}:${minute}:00+08:00`
  };
}

function computeShanghaiDate(baseDate = new Date()) {
  const utc = baseDate.getTime() + baseDate.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 60 * 60000);
}

function createMarkdown({ title, body, slug, lang, feature, image, imageText, aiSummary, date }) {
  const lines = [
    '---',
    `title: "${escapeYAML(title)}"`,
    'layout: default',
    'open_heart: true',
    `date: ${date}`
  ];

  if (feature) {
    lines.push('feature: 1');
  }

  if (lang && lang !== 'zh-CN') {
    lines.push(`lang: ${lang}`);
  }

  if (image && String(image).trim()) {
    lines.push(`image: ${String(image).trim()}`);
  }

  if (imageText && String(imageText).trim()) {
    lines.push(`image_text: "${escapeYAML(String(imageText).trim())}"`);
  }

  if (aiSummary) {
    lines.push(`ai_summary: "${escapeYAML(aiSummary)}"`);
  }

  if (slug && slug !== generateSlug(title)) {
    lines.push(`slug: "${escapeYAML(slug)}"`);
  }

  lines.push('---', '', body.trim(), '');

  return lines.join('\n');
}

function generateSlug(source) {
  if (!source) return `post-${Date.now().toString().slice(-6)}`;
  const clean = String(source)
    .trim()
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return clean || `post-${Date.now().toString().slice(-6)}`;
}

function escapeYAML(value) {
  return value.replace(/"/g, '\\"');
}

function isValidFilename(value) {
  if (typeof value !== 'string') return false;
  if (!value.endsWith('.md')) return false;
  if (value.includes('/') || value.includes('..')) return false;
  return /-post-/.test(value);
}

async function commitToGitHub({ token, repo, filepath, content, message }) {
  const baseUrl = 'https://api.github.com';
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'site-post-writer'
  };

  let targetPath = filepath;

  try {
    const checkResponse = await fetch(`${baseUrl}/repos/${repo}/contents/${targetPath}`, {
      headers
    });

    if (checkResponse.ok) {
      const timestamp = Date.now().toString().slice(-6);
      const dotIndex = targetPath.lastIndexOf('.');
      if (dotIndex > -1) {
        targetPath = `${targetPath.slice(0, dotIndex)}-${timestamp}${targetPath.slice(dotIndex)}`;
      } else {
        targetPath = `${targetPath}-${timestamp}`;
      }
    }
  } catch (error) {
    // 文件不存在时忽略错误
  }

  const payload = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: 'main',
    author: {
      name: 'Bazinga',
      email: 'zjb15239430906@gmail.com'
    },
    committer: {
      name: 'Bazinga',
      email: 'zjb15239430906@gmail.com'
    }
  };

  const response = await fetch(`${baseUrl}/repos/${repo}/contents/${targetPath}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const error = new Error(errorBody.message || 'GitHub API 请求失败');
    error.status = response.status;
    error.details = errorBody;
    throw error;
  }

  return await response.json();
}
