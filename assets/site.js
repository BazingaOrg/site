import { trackUmami } from './events.js'
import { initSakuraFall } from './sakura-fall.js'
import { initStarField } from './star-field.js'
import { initHomePhotoCarousel } from './home-photo-carousel.js'
import { syncWeather } from './weather.js'
import { initBioPresence } from './bio-presence.js'

const isChineseInterface = document.documentElement.lang?.startsWith('zh')

// Surfaces the live weather as a short clause on the location line, e.g.
// "Lives in Hangzhou, Zhejiang — raining now." Stays quiet when the sky is
// clear and degrades to the plain location line without JS.
function updateLocationWeather(condition) {
  const el = document.querySelector('.bio-location')
  if (!el) return

  if (!el.dataset.baseText) el.dataset.baseText = el.textContent.trim()
  const base = el.dataset.baseText

  const key = condition ? `weather${condition.charAt(0).toUpperCase()}${condition.slice(1)}` : ''
  const phrase = key ? el.dataset[key] : ''

  if (!phrase) {
    el.textContent = base
    return
  }

  el.textContent = isChineseInterface
    ? `${base.replace(/[。.]\s*$/, '')}，${phrase}。`
    : `${base.replace(/[.。]\s*$/, '')} — ${phrase}.`
}

function refreshWeather() {
  return syncWeather({ syncDefaultEffects: syncDefaultEffectsByDay })
    .then(data => updateLocationWeather(data?.condition))
}

if ('share' in navigator) {
  for (const shareButton of document.querySelectorAll('[data-share-url]')) {
    shareButton.hidden = false
    shareButton.addEventListener('click', event => {
      const url = shareButton.getAttribute('data-share-url')
      navigator.share({url}).then(() => {
        trackUmami('share_native', {
          shared_url: url,
          source_page: window.location.pathname,
          page_type: document.body.dataset.pageType || 'default',
          language: document.documentElement.lang || 'en-US'
        })
      }).catch(() => {
        // User cancelled share or the action failed; no tracking needed
      })
    })
  }
}

function syncDefaultEffectsByDay(isDay) {
  if (Number(isDay) === 1) {
    initSakuraFall()
    window.__starFieldMounted?.destroy()
    window.__starFieldMounted = null
    return
  }

  window.__sakuraFallMounted?.destroy()
  window.__sakuraFallMounted = null
  initStarField()
}

refreshWeather()
window.setInterval(refreshWeather, 15 * 60 * 1000)
initHomePhotoCarousel()
initBioPresence()

function normalizePath(pathname) {
  if (!pathname || pathname === '') return '/'
  return pathname.startsWith('/') ? pathname : `/${pathname}`
}

function toZhPath(pathname) {
  const path = normalizePath(pathname)
  if (path === '/zh-CN' || path === '/zh-CN/') return '/zh-CN/'
  if (path.startsWith('/zh-CN/')) return path
  if (path === '/') return '/zh-CN/'
  return `/zh-CN${path}`
}

function toEnPath(pathname) {
  const path = normalizePath(pathname)
  if (path === '/zh-CN' || path === '/zh-CN/') return '/'
  if (path.startsWith('/zh-CN/')) {
    const strippedPath = path.replace(/^\/zh-CN/, '')
    return strippedPath === '' ? '/' : strippedPath
  }
  return path
}

function initLanguageSwitcherLinks() {
  const languageSwitcher = document.querySelector('.lang')
  if (!languageSwitcher) return

  const zhLink = languageSwitcher.querySelector('a[srclang="zh-CN"]')
  const enLink = languageSwitcher.querySelector('a[srclang="en-US"]')
  if (!zhLink || !enLink) return

  const currentPath = window.location.pathname
  const zhPath = toZhPath(currentPath)
  const enPath = toEnPath(currentPath)

  zhLink.setAttribute('href', zhPath)
  enLink.setAttribute('href', enPath)

  const currentIsZh = currentPath === '/zh-CN' || currentPath.startsWith('/zh-CN/')
  zhLink.toggleAttribute('aria-current', currentIsZh)
  enLink.toggleAttribute('aria-current', !currentIsZh)
}

// Password show/hide toggle
function initPasswordToggle() {
  const passwordWrappers = document.querySelectorAll('.password-field-wrapper')

  passwordWrappers.forEach(wrapper => {
    const input = wrapper.querySelector('input[type="password"], input[type="text"]')
    const toggle = wrapper.querySelector('.password-toggle')

    if (!input || !toggle) return

    toggle.addEventListener('click', () => {
      const isPassword = input.type === 'password'
      input.type = isPassword ? 'text' : 'password'

      const eyeIcon = toggle.querySelector('.eye-icon')
      const eyeSlashIcon = toggle.querySelector('.eye-slash-icon')

      if (isPassword) {
        eyeIcon.style.display = 'none'
        eyeSlashIcon.style.display = 'block'
      } else {
        eyeIcon.style.display = 'block'
        eyeSlashIcon.style.display = 'none'
      }

      toggle.setAttribute('aria-label', isPassword
        ? (isChineseInterface ? '隐藏密码' : 'Hide password')
        : (isChineseInterface ? '显示密码' : 'Show password'))
    })
  })
}

// Initialize password toggle
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLanguageSwitcherLinks()
    initPasswordToggle()
  })
} else {
  initLanguageSwitcherLinks()
  initPasswordToggle()
}
