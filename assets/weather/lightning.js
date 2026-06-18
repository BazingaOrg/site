function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function initLightning() {
  if (window.__lightningMounted) return window.__lightningMounted

  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (prefersReducedMotion()) {
    let child = null
    let mounted = null

    function handleReducedMotionChange(event) {
      if (event.matches || child) return
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
      if (window.__lightningMounted === mounted) {
        window.__lightningMounted = null
      }
      child = initLightning()
    }

    mounted = {
      destroy() {
        reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
        child?.destroy()
        if (window.__lightningMounted === mounted || window.__lightningMounted === child) {
          window.__lightningMounted = null
        }
      }
    }

    reducedMotionMedia.addEventListener('change', handleReducedMotionChange)
    window.__lightningMounted = mounted
    return mounted
  }

  const flash = document.createElement('div')
  flash.className = 'weather-lightning-flash'
  flash.setAttribute('aria-hidden', 'true')
  document.body.appendChild(flash)

  let timer = null
  let cancelled = false

  function strike() {
    flash.classList.remove('weather-lightning-active')
    void flash.offsetWidth
    flash.classList.add('weather-lightning-active')
  }

  function scheduleStrike() {
    timer = window.setTimeout(() => {
      if (cancelled) return
      if (!document.hidden) strike()
      scheduleStrike()
    }, randomBetween(20000, 50000))
  }

  scheduleStrike()

  const mounted = {
    destroy() {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      flash.remove()
      if (window.__lightningMounted === mounted) {
        window.__lightningMounted = null
      }
    }
  }

  window.__lightningMounted = mounted
  return mounted
}
