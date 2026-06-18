const DESKTOP_DROP_COUNT = 150
const MOBILE_DROP_COUNT = 70

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function createDrop(width, height, initial = false) {
  const length = randomBetween(14, 30)
  return {
    x: randomBetween(-width * 0.1, width * 1.1),
    y: initial ? randomBetween(-height, height) : randomBetween(-height * 0.25, -length),
    length,
    speed: randomBetween(760, 1120),
    opacity: randomBetween(0.24, 0.58),
    drift: randomBetween(190, 270)
  }
}

export function initRain() {
  if (window.__rainMounted) return window.__rainMounted

  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (prefersReducedMotion()) {
    let child = null
    let mounted = null

    function handleReducedMotionChange(event) {
      if (event.matches || child) return
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
      if (window.__rainMounted === mounted) {
        window.__rainMounted = null
      }
      child = initRain()
    }

    mounted = {
      destroy() {
        reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
        child?.destroy()
        if (window.__rainMounted === mounted || window.__rainMounted === child) {
          window.__rainMounted = null
        }
      }
    }

    reducedMotionMedia.addEventListener('change', handleReducedMotionChange)
    window.__rainMounted = mounted
    return mounted
  }

  const canvas = document.createElement('canvas')
  canvas.className = 'weather-rain-canvas'
  canvas.setAttribute('aria-hidden', 'true')

  const context = canvas.getContext('2d')
  if (!context) return { destroy() {} }

  document.body.appendChild(canvas)

  let width = window.innerWidth
  let height = window.innerHeight
  let drops = []
  let frameId = null
  let previousTimestamp = null
  let running = false

  function targetCount() {
    return isMobileViewport() ? MOBILE_DROP_COUNT : DESKTOP_DROP_COUNT
  }

  function setSize() {
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = width
    canvas.height = height
  }

  function syncDropCount() {
    const count = targetCount()

    while (drops.length < count) {
      drops.push(createDrop(width, height, true))
    }

    if (drops.length > count) {
      drops = drops.slice(0, count)
    }
  }

  function recycleDrop(drop) {
    const next = createDrop(width, height)
    drop.x = next.x
    drop.y = next.y
    drop.length = next.length
    drop.speed = next.speed
    drop.opacity = next.opacity
    drop.drift = next.drift
  }

  function render(timestamp) {
    if (!running) return
    if (previousTimestamp === null) previousTimestamp = timestamp

    const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.05)
    previousTimestamp = timestamp

    context.clearRect(0, 0, width, height)
    context.lineWidth = 0.9
    context.lineCap = 'round'

    for (const drop of drops) {
      const endX = drop.x - drop.length * 0.3
      const endY = drop.y + drop.length

      context.beginPath()
      context.strokeStyle = `rgba(180, 200, 230, ${drop.opacity})`
      context.moveTo(drop.x, drop.y)
      context.lineTo(endX, endY)
      context.stroke()

      drop.x -= drop.drift * deltaSeconds
      drop.y += drop.speed * deltaSeconds

      if (drop.y - drop.length > height || drop.x < -80) {
        recycleDrop(drop)
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
    syncDropCount()
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
  syncDropCount()
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
      drops = []
      if (window.__rainMounted === mounted) {
        window.__rainMounted = null
      }
    }
  }

  window.__rainMounted = mounted
  return mounted
}
