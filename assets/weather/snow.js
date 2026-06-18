const DESKTOP_FLAKE_COUNT = 80
const MOBILE_FLAKE_COUNT = 40

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function createFlake(width, height, initial = false) {
  return {
    x: randomBetween(-width * 0.05, width * 1.05),
    y: initial ? randomBetween(-height, height) : randomBetween(-height * 0.25, -8),
    radius: randomBetween(1, 2.6),
    speed: randomBetween(38, 92),
    opacity: randomBetween(0.45, 0.9),
    swayAmplitude: randomBetween(10, 34),
    swayFrequency: randomBetween(0.6, 1.5),
    swayPhase: randomBetween(0, Math.PI * 2)
  }
}

export function initSnow() {
  if (window.__snowMounted) return window.__snowMounted

  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (prefersReducedMotion()) {
    let child = null
    let mounted = null

    function handleReducedMotionChange(event) {
      if (event.matches || child) return
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
      if (window.__snowMounted === mounted) {
        window.__snowMounted = null
      }
      child = initSnow()
    }

    mounted = {
      destroy() {
        reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
        child?.destroy()
        if (window.__snowMounted === mounted || window.__snowMounted === child) {
          window.__snowMounted = null
        }
      }
    }

    reducedMotionMedia.addEventListener('change', handleReducedMotionChange)
    window.__snowMounted = mounted
    return mounted
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'weather-snow-canvas'
  canvas.setAttribute('aria-hidden', 'true')

  const context = canvas.getContext('2d')
  if (!context) return { destroy() {} }

  document.body.appendChild(canvas)

  let width = window.innerWidth
  let height = window.innerHeight
  let flakes = []
  let frameId = null
  let previousTimestamp = null
  let running = false

  function targetCount() {
    return isMobileViewport() ? MOBILE_FLAKE_COUNT : DESKTOP_FLAKE_COUNT
  }

  function setSize() {
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = width
    canvas.height = height
  }

  function syncFlakeCount() {
    const count = targetCount()

    while (flakes.length < count) {
      flakes.push(createFlake(width, height, true))
    }

    if (flakes.length > count) {
      flakes = flakes.slice(0, count)
    }
  }

  function recycleFlake(flake) {
    const next = createFlake(width, height)
    flake.x = next.x
    flake.y = next.y
    flake.radius = next.radius
    flake.speed = next.speed
    flake.opacity = next.opacity
    flake.swayAmplitude = next.swayAmplitude
    flake.swayFrequency = next.swayFrequency
    flake.swayPhase = next.swayPhase
  }

  function render(timestamp) {
    if (!running) return
    if (previousTimestamp === null) previousTimestamp = timestamp

    const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.05)
    previousTimestamp = timestamp
    const time = timestamp / 1000

    context.clearRect(0, 0, width, height)

    for (const flake of flakes) {
      const renderX = flake.x + Math.sin(time * flake.swayFrequency + flake.swayPhase) * flake.swayAmplitude

      context.beginPath()
      context.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`
      context.arc(renderX, flake.y, flake.radius, 0, Math.PI * 2)
      context.fill()

      flake.y += flake.speed * deltaSeconds

      if (flake.y - flake.radius > height) {
        recycleFlake(flake)
      }
    }

    frameId = window.requestAnimationFrame(render)
  }

  function start() {
    if (running) return
    running = true
    frameId = window.requestAnimationFrame(render)
  }

  function stop() {
    running = false
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId)
      frameId = null
    }
    previousTimestamp = null
  }

  function handleResize() {
    setSize()
    syncFlakeCount()
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stop()
      return
    }

    if (!reducedMotionMedia.matches) start()
  }

  function handleReducedMotionChange(event) {
    if (event.matches) {
      stop()
      context.clearRect(0, 0, width, height)
      return
    }

    start()
  }

  setSize()
  syncFlakeCount()
  window.addEventListener('resize', handleResize)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  reducedMotionMedia.addEventListener('change', handleReducedMotionChange)
  start()

  const mounted = {
    destroy() {
      stop()
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
      canvas.remove()
      flakes = []
      if (window.__snowMounted === mounted) {
        window.__snowMounted = null
      }
    }
  }

  window.__snowMounted = mounted
  return mounted
}
