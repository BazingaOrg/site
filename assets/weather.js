import { initRain } from './weather/rain.js'
import { initSnow } from './weather/snow.js'
import { initFog } from './weather/fog.js'
import { initLightning } from './weather/lightning.js'

const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
  + '?latitude=30.27&longitude=120.16'
  + '&current=weather_code,is_day&timezone=Asia/Shanghai'

const CACHE_KEY = 'siteWeather'
const CACHE_TTL_MS = 15 * 60 * 1000
const STALE_LIMIT_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
const SUPPRESS_DEFAULT_CONDITIONS = new Set(['rain', 'snow', 'thunderstorm'])
const DARK_MODE_MEDIA = window.matchMedia('(prefers-color-scheme: dark)')

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82])
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const THUNDERSTORM_CODES = new Set([95, 96, 99])
const FOG_CODES = new Set([45, 48])

let activeWeather = null
let activeCondition = null
let activeIsDay = null
let inFlightWeather = null

DARK_MODE_MEDIA.addEventListener('change', () => {
  if (activeCondition !== 'thunderstorm') return

  if (DARK_MODE_MEDIA.matches && !activeWeather?.lightning) {
    activeWeather.lightning = initLightning()
    return
  }

  if (!DARK_MODE_MEDIA.matches && activeWeather?.lightning) {
    activeWeather.lightning.destroy()
    delete activeWeather.lightning
  }
})

export function weatherCodeToCondition(code) {
  const numericCode = Number(code)

  if (RAIN_CODES.has(numericCode)) return 'rain'
  if (SNOW_CODES.has(numericCode)) return 'snow'
  if (THUNDERSTORM_CODES.has(numericCode)) return 'thunderstorm'
  if (FOG_CODES.has(numericCode)) return 'fog'

  return 'clear'
}

function now() {
  return Date.now()
}

function normalizeWeatherData(data) {
  if (!data || typeof data !== 'object') return null
  if (!['rain', 'snow', 'thunderstorm', 'fog', 'clear'].includes(data.condition)) return null

  const fetchedAt = Number(data.fetchedAt)
  if (!Number.isFinite(fetchedAt)) return null

  return {
    condition: data.condition,
    isDay: Number(data.isDay) === 1 ? 1 : 0,
    fetchedAt
  }
}

function readStoredCache() {
  try {
    const rawCache = window.localStorage?.getItem(CACHE_KEY)
    if (!rawCache) return null
    return normalizeWeatherData(JSON.parse(rawCache))
  } catch (error) {
    console.warn('[weather] Failed to read cached weather.', error)
    return null
  }
}

function writeCache(data) {
  try {
    window.localStorage?.setItem(CACHE_KEY, JSON.stringify(data))
  } catch (error) {
    console.warn('[weather] Failed to write cached weather.', error)
  }
}

function readFreshCache() {
  const cached = readStoredCache()
  if (!cached) return null
  return now() - cached.fetchedAt <= CACHE_TTL_MS ? cached : null
}

async function fetchWeather() {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort()
  }, FETCH_TIMEOUT_MS)

  try {
    const response = await window.fetch(WEATHER_ENDPOINT, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Open-Meteo responded with ${response.status}`)
    }

    const payload = await response.json()
    const current = payload?.current
    const data = {
      condition: weatherCodeToCondition(current?.weather_code),
      isDay: Number(current?.is_day) === 1 ? 1 : 0,
      fetchedAt: now()
    }

    writeCache(data)
    return data
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function getWeatherData() {
  const freshCache = readFreshCache()
  if (freshCache) return freshCache

  try {
    if (!inFlightWeather) {
      inFlightWeather = fetchWeather().finally(() => {
        inFlightWeather = null
      })
    }
    return await inFlightWeather
  } catch (error) {
    console.warn('[weather] Failed to fetch weather.', error)
    const staleCache = readStoredCache()
    if (staleCache && now() - staleCache.fetchedAt <= STALE_LIMIT_MS) {
      return staleCache
    }
  }

  return {
    condition: 'clear',
    isDay: 1,
    fetchedAt: now()
  }
}

function destroyAllWeather() {
  activeWeather?.rain?.destroy()
  activeWeather?.snow?.destroy()
  activeWeather?.fog?.destroy()
  activeWeather?.lightning?.destroy()
  activeWeather = null
}

function applyEffect(data, syncDefaultEffects) {
  const condition = data?.condition || 'clear'
  const isDay = Number(data?.isDay) === 1 ? 1 : 0
  const suppressDefaults = SUPPRESS_DEFAULT_CONDITIONS.has(condition)

  if (activeCondition === condition) {
    const defaultEffectsNeedSync = activeIsDay !== isDay
    activeIsDay = isDay
    if (suppressDefaults) {
      window.__sakuraFallMounted?.destroy()
      window.__sakuraFallMounted = null
      window.__starFieldMounted?.destroy()
      window.__starFieldMounted = null
    } else if (defaultEffectsNeedSync) {
      syncDefaultEffects?.(isDay)
    }
    return
  }

  destroyAllWeather()
  activeCondition = condition
  activeIsDay = isDay

  if (suppressDefaults) {
    window.__sakuraFallMounted?.destroy()
    window.__sakuraFallMounted = null
    window.__starFieldMounted?.destroy()
    window.__starFieldMounted = null
  } else {
    syncDefaultEffects?.(isDay)
  }

  activeWeather = {}

  if (condition === 'rain') {
    activeWeather.rain = initRain()
  } else if (condition === 'snow') {
    activeWeather.snow = initSnow()
  } else if (condition === 'thunderstorm') {
    activeWeather.rain = initRain()
    if (DARK_MODE_MEDIA.matches) {
      activeWeather.lightning = initLightning()
    }
  }

  if (condition === 'fog') {
    activeWeather.fog = initFog()
  }
}

export async function syncWeather({ syncDefaultEffects } = {}) {
  try {
    const data = await getWeatherData()
    applyEffect(data, syncDefaultEffects)
    return data
  } catch (error) {
    console.warn('[weather] Failed to apply weather effect.', error)
    activeCondition = 'clear'
    activeIsDay = 1
    destroyAllWeather()
    syncDefaultEffects?.(1)
    return {
      condition: 'clear',
      isDay: 1,
      fetchedAt: now()
    }
  }
}
