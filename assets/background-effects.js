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

// Read the scheme with a fresh query: some embedders update newly created
// MediaQueryLists before long-lived ones, so the cached object is only
// trusted as an event source, never as state.
function isDarkScheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

let currentCondition = null
let overlays = {}
let applyRunId = 0
let lastAppliedIsDark = null

DARK_MODE_MEDIA.addEventListener('change', () => {
  if (currentCondition !== null) {
    applyMatrix().catch(logApplyError)
  }
})

// Some browsers throttle media-query events for hidden tabs (e.g. the OS
// auto-switches theme at sunset while the tab is in the background), so
// double-check the scheme whenever the page becomes visible again.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || currentCondition === null) return
  if (isDarkScheme() !== lastAppliedIsDark) {
    applyMatrix().catch(logApplyError)
  }
})

function logApplyError(error) {
  console.warn('[background] Failed to apply background effects.', error)
}

async function setAmbient(kind) {
  if (kind !== 'stars' && window.__starFieldMounted) {
    window.__starFieldMounted.destroy()
    window.__starFieldMounted = null
  }
  if (kind !== 'sakura' && window.__sakuraFallMounted) {
    window.__sakuraFallMounted.destroy()
    window.__sakuraFallMounted = null
  }

  if (kind === 'sakura' && !window.__sakuraFallMounted) {
    const { initSakuraFall } = await import('./sakura-fall.js')
    return initSakuraFall
  }
  if (kind === 'stars' && !window.__starFieldMounted) {
    const { initStarField } = await import('./star-field.js')
    return initStarField
  }
  return null
}

async function applyMatrix() {
  const runId = ++applyRunId
  const condition = currentCondition || 'clear'
  const isDark = isDarkScheme()
  lastAppliedIsDark = isDark

  const wanted = {
    ambient: AMBIENT_SUPPRESSING.has(condition) ? null : (isDark ? 'stars' : 'sakura'),
    rain: condition === 'rain' || condition === 'thunderstorm',
    snow: condition === 'snow',
    fog: condition === 'fog',
    lightning: condition === 'thunderstorm' && isDark
  }

  // Tear down overlays that no longer apply before mounting new ones.
  for (const key of ['rain', 'snow', 'fog', 'lightning']) {
    if (!wanted[key] && overlays[key]) {
      overlays[key].destroy()
      delete overlays[key]
    }
  }

  const mountAmbient = await setAmbient(wanted.ambient)
  if (runId !== applyRunId) return
  mountAmbient?.()

  const loaders = {
    rain: () => import('./weather/rain.js').then(m => m.initRain),
    snow: () => import('./weather/snow.js').then(m => m.initSnow),
    fog: () => import('./weather/fog.js').then(m => m.initFog),
    lightning: () => import('./weather/lightning.js').then(m => m.initLightning)
  }

  for (const key of ['rain', 'snow', 'fog', 'lightning']) {
    if (!wanted[key] || overlays[key]) continue
    const init = await loaders[key]()
    // The matrix may have changed while the module downloaded.
    if (runId !== applyRunId) return
    overlays[key] = init()
  }
}

export function syncBackgroundEffects(condition) {
  currentCondition = condition || 'clear'
  return applyMatrix().catch(logApplyError)
}
