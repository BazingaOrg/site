export function initFog() {
  if (window.__fogMounted) return window.__fogMounted

  const layer = document.createElement('div')
  layer.className = 'weather-fog-layer'
  layer.setAttribute('aria-hidden', 'true')

  const nearCloud = document.createElement('div')
  nearCloud.className = 'weather-fog-cloud'

  const farCloud = document.createElement('div')
  farCloud.className = 'weather-fog-cloud'

  layer.append(nearCloud, farCloud)
  document.body.appendChild(layer)

  const mounted = {
    destroy() {
      layer.remove()
      if (window.__fogMounted === mounted) {
        window.__fogMounted = null
      }
    }
  }

  window.__fogMounted = mounted
  return mounted
}
