const SLIDE_INTERVAL_MS = 4500
const SWIPE_THRESHOLD_PX = 40
const SWIPE_PAUSE_AFTER_MS = 1000
const POSITION_CLASSES = ['is-active', 'is-prev', 'is-next', 'is-far-prev', 'is-far-next']

function normalizeIndex(index, length) {
  return ((index % length) + length) % length
}

export function initHomePhotoCarousel() {
  const root = document.querySelector('[data-photo-carousel]')
  if (!root) return null

  const slides = Array.from(root.querySelectorAll('.photo-carousel-stage img'))
  if (slides.length === 0) return null

  const stage = root.querySelector('.photo-carousel-stage')

  let activeIndex = slides.findIndex(slide => slide.classList.contains('is-active'))
  if (activeIndex < 0) activeIndex = 0
  syncSlidePositions()

  if (slides.length < 2) return null

  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
  let timerId = null
  let pausedUntil = 0
  let touchStartX = 0
  let touchStartY = 0
  let dragging = false

  function syncSlidePositions() {
    slides.forEach((slide, index) => {
      slide.classList.remove(...POSITION_CLASSES)

      if (index === activeIndex) {
        slide.classList.add('is-active')
        return
      }

      const previousIndex = normalizeIndex(activeIndex - 1, slides.length)
      const nextIndex = normalizeIndex(activeIndex + 1, slides.length)
      const farPreviousIndex = normalizeIndex(activeIndex - 2, slides.length)
      const farNextIndex = normalizeIndex(activeIndex + 2, slides.length)

      if (index === previousIndex) {
        slide.classList.add('is-prev')
      } else if (index === nextIndex) {
        slide.classList.add('is-next')
      } else if (slides.length > 3 && index === farPreviousIndex) {
        slide.classList.add('is-far-prev')
      } else if (slides.length > 3 && index === farNextIndex) {
        slide.classList.add('is-far-next')
      }
    })
  }

  function showSlide(nextIndex) {
    const target = normalizeIndex(nextIndex, slides.length)
    if (target === activeIndex) return

    activeIndex = target
    syncSlidePositions()
  }

  function clearTimer() {
    if (timerId === null) return
    window.clearTimeout(timerId)
    timerId = null
  }

  function schedule() {
    clearTimer()
    if (reducedMotionMedia.matches) return
    timerId = window.setTimeout(advance, SLIDE_INTERVAL_MS)
  }

  function advance() {
    if (document.hidden || Date.now() < pausedUntil) {
      schedule()
      return
    }

    showSlide(activeIndex + 1)
    schedule()
  }

  function pauseIndefinitely() {
    pausedUntil = Infinity
    clearTimer()
  }

  function handlePointerEnter(event) {
    if (event.pointerType === 'touch') return
    pauseIndefinitely()
  }

  function resume() {
    pausedUntil = 0
    schedule()
  }

  function endDrag() {
    dragging = false
    delete root.dataset.dragging
    stage.style.removeProperty('--stage-drag')
  }

  function handleTouchStart(event) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    dragging = false
    delete root.dataset.swiping
  }

  function handleTouchMove(event) {
    const touch = event.touches[0]
    if (!touch) return

    const deltaX = touch.clientX - touchStartX
    const deltaY = touch.clientY - touchStartY

    // Wait until the gesture is clearly horizontal so vertical scroll is untouched.
    if (!dragging) {
      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return
      dragging = true
      root.dataset.dragging = '1'
      pauseIndefinitely()
    }

    // Damped rubber-band: the pile follows the finger without fully chasing it.
    stage.style.setProperty('--stage-drag', `${deltaX * 0.35}px`)
  }

  function handleTouchEnd(event) {
    const wasDragging = dragging
    endDrag()

    const touch = event.changedTouches[0]
    if (!touch) {
      if (wasDragging) resume()
      return
    }

    const deltaX = touch.clientX - touchStartX
    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX) {
      root.dataset.swiping = '1'
      showSlide(activeIndex + (deltaX < 0 ? 1 : -1))
    }

    pausedUntil = Date.now() + SWIPE_PAUSE_AFTER_MS
    schedule()
  }

  function handlePointerMove(event) {
    if (event.pointerType === 'touch' || reducedMotionMedia.matches) return
    const rect = root.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const mx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
    const my = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
    stage.style.setProperty('--stage-mx', mx.toFixed(3))
    stage.style.setProperty('--stage-my', my.toFixed(3))
  }

  function resetParallax() {
    stage.style.setProperty('--stage-mx', '0')
    stage.style.setProperty('--stage-my', '0')
  }

  function handlePointerLeave() {
    resetParallax()
    resume()
  }

  function handleKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    showSlide(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1))
    pausedUntil = Date.now() + SWIPE_PAUSE_AFTER_MS
    schedule()
  }

  function handleClick(event) {
    if (root.dataset.swiping !== '1') return
    event.preventDefault()
    delete root.dataset.swiping
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimer()
      return
    }

    schedule()
  }

  function handleReducedMotionChange(event) {
    if (event.matches) {
      clearTimer()
      showSlide(0)
      return
    }

    schedule()
  }

  root.addEventListener('pointerenter', handlePointerEnter)
  root.addEventListener('pointermove', handlePointerMove)
  root.addEventListener('pointerleave', handlePointerLeave)
  root.addEventListener('focusin', pauseIndefinitely)
  root.addEventListener('focusout', resume)
  root.addEventListener('keydown', handleKeydown)
  root.addEventListener('touchstart', handleTouchStart, { passive: true })
  root.addEventListener('touchmove', handleTouchMove, { passive: true })
  root.addEventListener('touchend', handleTouchEnd)
  root.addEventListener('touchcancel', endDrag)
  root.addEventListener('click', handleClick)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  reducedMotionMedia.addEventListener('change', handleReducedMotionChange)

  schedule()

  return {
    destroy() {
      clearTimer()
      root.removeEventListener('pointerenter', handlePointerEnter)
      root.removeEventListener('pointermove', handlePointerMove)
      root.removeEventListener('pointerleave', handlePointerLeave)
      root.removeEventListener('focusin', pauseIndefinitely)
      root.removeEventListener('focusout', resume)
      root.removeEventListener('keydown', handleKeydown)
      root.removeEventListener('touchstart', handleTouchStart)
      root.removeEventListener('touchmove', handleTouchMove)
      root.removeEventListener('touchend', handleTouchEnd)
      root.removeEventListener('touchcancel', endDrag)
      root.removeEventListener('click', handleClick)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
    }
  }
}
