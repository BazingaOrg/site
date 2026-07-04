// Single orchestrator for every decorative fixed layer.
//
// Decision matrix (docs/optimization-plan.md):
//   ambient        : light scheme → sakura petals | dark scheme → star field.
//                    The ambient layer follows the rendered canvas, not the
//                    sun — petals are unreadable on a near-black page and
//                    stars vanish on a near-white one.
//   rain / snow    : replaces the ambient layer (its canvas mounts alone).
//   thunderstorm   : rain, plus lightning flashes when the scheme is dark
//                    (a white flash has no contrast on a light canvas).
//   fog            : stacks — a translucent veil over the ambient layer.
//
// Scheme changes re-apply the whole matrix immediately; weather changes come
// in via syncBackgroundEffects() from the 15-minute poll in site.js.

const DARK_MODE_MEDIA = window.matchMedia('(prefers-color-scheme: dark)')
const AMBIENT_SUPPRESSING = new Set(['rain', 'snow', 'thunderstorm'])
const OVERLAY_KEYS = ['rain', 'snow', 'fog', 'lightning']

const AMBIENT_LOADERS = {
  sakura: () => import('./sakura-fall.js').then(m => m.initSakuraFall),
  stars: () => import('./star-field.js').then(m => m.initStarField)
}

const OVERLAY_LOADERS = {
  rain: () => import('./weather/rain.js').then(m => m.initRain),
  snow: () => import('./weather/snow.js').then(m => m.initSnow),
  fog: () => import('./weather/fog.js').then(m => m.initFog),
  lightning: () => import('./weather/lightning.js').then(m => m.initLightning)
}

// Read the scheme with a fresh query: some embedders update newly created
// MediaQueryLists before long-lived ones, so the cached object is only
// trusted as an event source, never as state.
function isDarkScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let currentCondition = null
let overlays = {}
let applyRunId = 0

DARK_MODE_MEDIA.addEventListener('change', () => {
  if (currentCondition !== null) {
    applyMatrix().catch(logApplyError)
  }
})

// Browsers may throttle media-query events for hidden tabs (e.g. the OS
// auto-switches theme at sunset while the tab is in the background), and an
// apply can fail mid-flight (offline import). applyMatrix is idempotent —
// it only tears down what no longer applies and mounts what is missing — so
// simply re-apply whenever the page becomes visible again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || currentCondition === null) return
  applyMatrix().catch(logApplyError)
})

function logApplyError(error) {
  console.warn('[background] Failed to apply background effects.', error)
}

function ambientMounted(kind) {
  if (kind === 'sakura') return Boolean(window.__sakuraFallMounted)
  if (kind === 'stars') return Boolean(window.__starFieldMounted)
  return false
}

function destroyAmbientExcept(kind) {
  if (kind !== 'stars' && window.__starFieldMounted) {
    window.__starFieldMounted.destroy()
    window.__starFieldMounted = null
  }
  if (kind !== 'sakura' && window.__sakuraFallMounted) {
    window.__sakuraFallMounted.destroy()
    window.__sakuraFallMounted = null
  }
}

async function applyMatrix() {
  const runId = ++applyRunId
  const condition = currentCondition || 'clear'
  const isDark = isDarkScheme()

  const ambient = AMBIENT_SUPPRESSING.has(condition) ? null : (isDark ? 'stars' : 'sakura')
  const wanted = {
    rain: condition === 'rain' || condition === 'thunderstorm',
    snow: condition === 'snow',
    fog: condition === 'fog',
    lightning: condition === 'thunderstorm' && isDark
  }

  // Resolve every missing module BEFORE tearing anything down, in parallel:
  // a failed import (offline, cold cache) then leaves the current layers in
  // place instead of a blank background, and a thunderstorm doesn't fetch
  // rain and lightning back-to-back.
  const ambientNeedsInit = ambient !== null && !ambientMounted(ambient)
  const missingOverlays = OVERLAY_KEYS.filter(key => wanted[key] && !overlays[key])
  const [ambientInit, ...overlayInits] = await Promise.all([
    ambientNeedsInit ? AMBIENT_LOADERS[ambient]() : Promise.resolve(null),
    ...missingOverlays.map(key => OVERLAY_LOADERS[key]())
  ])
  // The matrix may have changed while the modules downloaded.
  if (runId !== applyRunId) return

  destroyAmbientExcept(ambient)
  for (const key of OVERLAY_KEYS) {
    if (!wanted[key] && overlays[key]) {
      overlays[key].destroy()
      delete overlays[key]
    }
  }

  ambientInit?.()
  missingOverlays.forEach((key, index) => {
    overlays[key] = overlayInits[index]()
  })
}

export function syncBackgroundEffects(condition) {
  currentCondition = condition || 'clear'
  return applyMatrix().catch(logApplyError)
}
