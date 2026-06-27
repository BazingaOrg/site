const FAR_LAYER = {
  name: 'far',
  desktopCount: 160,
  mobileCount: 70,
  size: [0.8, 1.2],
  opacity: [0.45, 0.7],
  twinkle: false
}

const MID_LAYER = {
  name: 'mid',
  desktopCount: 60,
  mobileCount: 30,
  size: [1.3, 2],
  opacity: [0.55, 0.85],
  twinkle: true,
  twinkleDuration: [2.0, 4.5]
}

const NEAR_LAYER = {
  name: 'near',
  desktopCount: 15,
  mobileCount: 8,
  size: [2.2, 3],
  opacity: [0.8, 1],
  twinkle: true,
  twinkleDuration: [4, 7],
  glow: true
}

const LEO_CONSTELLATION = {
  viewBox: '0 0 100 80',
  stars: [
    { x: 35, y: 65, size: 3.4, name: 'Regulus' },
    { x: 35, y: 55, size: 2.2, name: 'eta Leo' },
    { x: 30, y: 45, size: 2.8, name: 'Algieba' },
    { x: 28, y: 35, size: 2.2, name: 'Adhafera' },
    { x: 33, y: 28, size: 2.0, name: 'Ras Elased Bor.' },
    { x: 40, y: 25, size: 2.2, name: 'Ras Elased Aus.' },
    { x: 60, y: 65, size: 2.4, name: 'Chertan' },
    { x: 65, y: 50, size: 2.6, name: 'Zosma' },
    { x: 90, y: 55, size: 2.8, name: 'Denebola' }
  ],
  lines: [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
    [0, 6], [2, 7], [6, 7], [6, 8], [7, 8]
  ]
}

const COLOR_PALETTE = [
  { weight: 0.5, color: 'rgb(255, 255, 255)' },
  { weight: 0.16, color: 'rgb(255, 245, 230)' },
  { weight: 0.18, color: 'rgb(214, 226, 255)' },
  { weight: 0.08, color: 'rgb(183, 203, 255)' },
  { weight: 0.05, color: 'rgb(255, 224, 196)' },
  { weight: 0.03, color: 'rgb(255, 198, 170)' }
]

// Stars that make up the unresolved star clouds of the Milky Way band.
const GALAXY_LAYER = {
  name: 'galaxy',
  desktopCount: 260,
  mobileCount: 120,
  size: [0.5, 1.4],
  opacity: [0.28, 0.66],
  twinkle: false
}

// The band sweeps top → bottom, drifting slightly right (like the reference sky).
const GALAXY_BAND = {
  topX: 56,
  bottomX: 66,
  spread: 11
}

const SHOOTER_INTERVAL = [16000, 40000]
const SHOOTER_DURATION = [1.2, 2.2]
const SHOOTER_ANGLE = [145, 165]
const SHOOTER_LENGTH = [220, 380]
const SHOOTER_TRAVEL = [800, 1300]

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function randomFromRange([min, max]) {
  return randomBetween(min, max)
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px)').matches
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function pickColor() {
  const total = COLOR_PALETTE.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = Math.random() * total
  for (const entry of COLOR_PALETTE) {
    roll -= entry.weight
    if (roll <= 0) return entry.color
  }
  return COLOR_PALETTE[0].color
}

function createStar(layer, reducedMotion) {
  const star = document.createElement('span')
  star.className = `star-field-star star-field-star--${layer.name}`

  const size = randomFromRange(layer.size).toFixed(2)
  const opacity = randomFromRange(layer.opacity).toFixed(2)
  const color = pickColor()

  star.style.setProperty('--star-x', `${randomBetween(0, 100).toFixed(2)}%`)
  star.style.setProperty('--star-y', `${randomBetween(0, 100).toFixed(2)}%`)
  star.style.setProperty('--star-size', `${size}px`)
  star.style.setProperty('--star-color', color)
  star.style.setProperty('--star-base-opacity', opacity)

  if (layer.glow) {
    star.style.setProperty('--star-glow', `${(parseFloat(size) * 1.2).toFixed(2)}px`)
  }

  if (layer.twinkle && !reducedMotion) {
    const duration = randomFromRange(layer.twinkleDuration).toFixed(2)
    const delay = (-randomBetween(0, parseFloat(duration))).toFixed(2)
    star.style.setProperty('--twinkle-duration', `${duration}s`)
    star.style.setProperty('--twinkle-delay', `${delay}s`)
    star.classList.add('star-field-star--twinkle')
  }

  return star
}

function spawnLayer(container, layer, reducedMotion) {
  const count = isMobileViewport() ? layer.mobileCount : layer.desktopCount
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < count; index += 1) {
    fragment.appendChild(createStar(layer, reducedMotion))
  }
  container.appendChild(fragment)
}

// Rough normal distribution (sum of uniforms) for clustering toward the band axis.
function gaussianUnit() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
}

function createGalaxyStar(layer) {
  const star = document.createElement('span')
  star.className = `star-field-star star-field-star--${layer.name}`

  const verticalFraction = Math.random()
  const centerX = GALAXY_BAND.topX + (GALAXY_BAND.bottomX - GALAXY_BAND.topX) * verticalFraction
  const x = centerX + gaussianUnit() * GALAXY_BAND.spread

  const size = randomFromRange(layer.size).toFixed(2)
  const opacity = randomFromRange(layer.opacity).toFixed(2)

  star.style.setProperty('--star-x', `${x.toFixed(2)}%`)
  star.style.setProperty('--star-y', `${(verticalFraction * 100).toFixed(2)}%`)
  star.style.setProperty('--star-size', `${size}px`)
  star.style.setProperty('--star-color', pickColor())
  star.style.setProperty('--star-base-opacity', opacity)

  return star
}

function spawnGalaxyStars(container, layer) {
  const count = isMobileViewport() ? layer.mobileCount : layer.desktopCount
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < count; index += 1) {
    fragment.appendChild(createGalaxyStar(layer))
  }
  container.appendChild(fragment)
}

function buildGalaxy(container) {
  const band = document.createElement('div')
  band.className = 'star-field-galaxy'
  band.setAttribute('aria-hidden', 'true')
  container.appendChild(band)
}

function buildConstellation(container, reducedMotion) {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'star-field-constellation')
  svg.setAttribute('viewBox', LEO_CONSTELLATION.viewBox)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('aria-label', 'Leo constellation')

  LEO_CONSTELLATION.lines.forEach(([aIdx, bIdx], lineIdx) => {
    const a = LEO_CONSTELLATION.stars[aIdx]
    const b = LEO_CONSTELLATION.stars[bIdx]
    const line = document.createElementNS(NS, 'line')
    line.setAttribute('x1', a.x)
    line.setAttribute('y1', a.y)
    line.setAttribute('x2', b.x)
    line.setAttribute('y2', b.y)
    line.setAttribute('pathLength', '1')
    line.setAttribute('class', 'star-field-constellation-line')
    if (!reducedMotion) {
      line.style.setProperty('--line-delay', `${(0.3 + lineIdx * 0.12).toFixed(2)}s`)
    }
    svg.appendChild(line)
  })

  LEO_CONSTELLATION.stars.forEach((star, starIdx) => {
    const circle = document.createElementNS(NS, 'circle')
    circle.setAttribute('cx', star.x)
    circle.setAttribute('cy', star.y)
    circle.setAttribute('r', (star.size * 0.5).toFixed(2))
    circle.setAttribute('class', 'star-field-constellation-star')
    if (!reducedMotion) {
      circle.style.setProperty('--star-delay', `${(starIdx * 0.18).toFixed(2)}s`)
      circle.style.setProperty('--star-glow-duration', `${(3 + (starIdx % 4) * 0.7).toFixed(2)}s`)
    }
    svg.appendChild(circle)
  })

  container.appendChild(svg)
}

function spawnShooter(container) {
  const shooter = document.createElement('span')
  shooter.className = 'star-field-shooter'

  const angle = randomFromRange(SHOOTER_ANGLE).toFixed(2)
  const duration = randomFromRange(SHOOTER_DURATION).toFixed(2)
  const length = randomFromRange(SHOOTER_LENGTH).toFixed(0)
  const travel = randomFromRange(SHOOTER_TRAVEL).toFixed(0)
  const startX = randomBetween(55, 92).toFixed(2)
  const startY = randomBetween(4, 32).toFixed(2)

  shooter.style.setProperty('--shooter-x', `${startX}%`)
  shooter.style.setProperty('--shooter-y', `${startY}%`)
  shooter.style.setProperty('--shooter-angle', `${angle}deg`)
  shooter.style.setProperty('--shooter-duration', `${duration}s`)
  shooter.style.setProperty('--shooter-length', `${length}px`)
  shooter.style.setProperty('--shooter-travel', `${travel}px`)

  shooter.addEventListener('animationend', () => {
    shooter.remove()
  }, { once: true })

  container.appendChild(shooter)
}

function scheduleShooter(container, state) {
  const delay = randomBetween(...SHOOTER_INTERVAL)
  state.shooterTimer = window.setTimeout(() => {
    if (state.cancelled) return
    if (!document.hidden) {
      spawnShooter(container)
    }
    scheduleShooter(container, state)
  }, delay)
}

export function initStarField() {
  if (window.__starFieldMounted) return window.__starFieldMounted

  const reducedMotion = prefersReducedMotion()
  const layer = document.createElement('div')
  layer.className = 'star-field-layer'
  layer.setAttribute('aria-hidden', 'true')

  buildGalaxy(layer)
  spawnGalaxyStars(layer, GALAXY_LAYER)
  spawnLayer(layer, FAR_LAYER, reducedMotion)
  spawnLayer(layer, MID_LAYER, reducedMotion)
  spawnLayer(layer, NEAR_LAYER, reducedMotion)
  buildConstellation(layer, reducedMotion)

  document.body.appendChild(layer)

  const state = { shooterTimer: null, cancelled: false }
  if (!reducedMotion) {
    scheduleShooter(layer, state)
  }

  const mounted = {
    layer,
    destroy() {
      state.cancelled = true
      if (state.shooterTimer) {
        window.clearTimeout(state.shooterTimer)
        state.shooterTimer = null
      }
      layer.remove()
      if (window.__starFieldMounted === mounted) {
        window.__starFieldMounted = null
      }
    }
  }

  window.__starFieldMounted = mounted
  return mounted
}
