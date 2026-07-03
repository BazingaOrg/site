// Homepage photo carousel — direction-aware slide track.
//
// Model: the active photo is centered; its neighbours wait just outside the
// stage (positioned via --slide-x in CSS). Advancing slides the row along the
// gesture axis, so motion always tells you which way you went. Controls
// (arrows + dots with an autoplay progress fill) are injected here so the
// no-JS fallback stays a plain link showing the first photo.

const SLIDE_INTERVAL_MS = 4500
const SWIPE_THRESHOLD_PX = 40
const SWIPE_VELOCITY_PX_MS = 0.5
const INTERACTION_PAUSE_MS = 4500

function normalizeIndex(index, length) {
  return ((index % length) + length) % length
}

export function initHomePhotoCarousel() {
  const root = document.querySelector('[data-photo-carousel]')
  if (!root) return null

  const link = root.querySelector('.photo-carousel-link')
  const stage = root.querySelector('.photo-carousel-stage')
  const slides = stage ? Array.from(stage.querySelectorAll('img')) : []
  if (!link || slides.length === 0) return null

  let activeIndex = Math.max(slides.findIndex(slide => slide.classList.contains('is-active')), 0)
  if (slides.length < 2) return null

  const isChineseInterface = document.documentElement.lang?.startsWith('zh')
  const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')

  let timerId = null
  let dots = []
  const controls = []
  let touchStartX = 0
  let touchStartY = 0
  let touchStartTime = 0
  let swipeClickSuppressTimer = null
  let dragging = false

  // --- layout ---------------------------------------------------------------

  function syncStageWidth() {
    root.style.setProperty('--carousel-w', `${link.clientWidth}px`)
  }

  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(syncStageWidth) : null
  resizeObserver?.observe(link)
  syncStageWidth()

  // --- controls ---------------------------------------------------------------

  function arrowSvg(direction) {
    const points = direction === 'prev' ? '9.5,3.5 5,8 9.5,12.5' : '6.5,3.5 11,8 6.5,12.5'
    return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"></polyline></svg>`
  }

  function buildControls() {
    for (const direction of ['prev', 'next']) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `photo-carousel-arrow photo-carousel-arrow--${direction}`
      button.setAttribute('aria-label', direction === 'prev'
        ? (isChineseInterface ? '上一张照片' : 'Previous photo')
        : (isChineseInterface ? '下一张照片' : 'Next photo'))
      button.innerHTML = arrowSvg(direction)
      button.addEventListener('click', () => {
        goTo(activeIndex + (direction === 'prev' ? -1 : 1))
        restartAutoplay()
      })
      root.appendChild(button)
      controls.push(button)
    }

    const dotsContainer = document.createElement('div')
    dotsContainer.className = 'photo-carousel-dots'
    dots = slides.map((slide, index) => {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.className = 'photo-carousel-dot'
      dot.setAttribute('aria-label', isChineseInterface
        ? `第 ${index + 1} 张，共 ${slides.length} 张`
        : `Photo ${index + 1} of ${slides.length}`)
      dot.addEventListener('click', () => {
        goTo(index)
        restartAutoplay()
      })
      dotsContainer.appendChild(dot)
      return dot
    })
    root.appendChild(dotsContainer)
    controls.push(dotsContainer)
  }

  function syncDots() {
    dots.forEach((dot, index) => {
      const isCurrent = index === activeIndex
      if (isCurrent) {
        dot.setAttribute('aria-current', 'true')
      } else {
        dot.removeAttribute('aria-current')
        dot.classList.remove('is-running')
      }
    })
  }

  function restartDotProgress() {
    const dot = dots[activeIndex]
    if (!dot) return
    dot.classList.remove('is-running')
    void dot.offsetWidth // restart the CSS animation from zero
    dot.classList.add('is-running')
  }

  function stopDotProgress() {
    dots[activeIndex]?.classList.remove('is-running')
  }

  // --- slide positioning ------------------------------------------------------

  function snapTo(slide, className) {
    slide.classList.add('is-snap')
    slide.classList.remove('is-active', 'is-prev', 'is-next')
    if (className) slide.classList.add(className)
    void slide.offsetWidth
    slide.classList.remove('is-snap')
  }

  function syncSlidePositions() {
    const previousIndex = normalizeIndex(activeIndex - 1, slides.length)
    const nextIndex = normalizeIndex(activeIndex + 1, slides.length)

    slides.forEach((slide, index) => {
      if (index === activeIndex) {
        slide.classList.add('is-active')
        slide.classList.remove('is-prev', 'is-next')
      } else if (index === previousIndex) {
        // A newly recruited neighbour teleports to its waiting spot; a slide
        // that is animating out (was active) keeps its transition.
        if (!slide.classList.contains('is-active') && !slide.classList.contains('is-prev')) {
          snapTo(slide, 'is-prev')
        } else {
          slide.classList.remove('is-active', 'is-next')
          slide.classList.add('is-prev')
        }
      } else if (index === nextIndex) {
        if (!slide.classList.contains('is-active') && !slide.classList.contains('is-next')) {
          snapTo(slide, 'is-next')
        } else {
          slide.classList.remove('is-active', 'is-prev')
          slide.classList.add('is-next')
        }
      } else {
        slide.classList.remove('is-active', 'is-prev', 'is-next')
      }
    })
  }

  function goTo(index) {
    const target = normalizeIndex(index, slides.length)
    if (target === activeIndex) return

    // For non-adjacent jumps (dot clicks), pre-position the target on the
    // side matching the shortest travel direction so it slides in naturally.
    const forwardDistance = normalizeIndex(target - activeIndex, slides.length)
    const goingForward = forwardDistance <= slides.length / 2
    const isAdjacent = forwardDistance === 1 || forwardDistance === slides.length - 1
    const targetSlide = slides[target]
    if (!isAdjacent) {
      snapTo(targetSlide, goingForward ? 'is-next' : 'is-prev')
    }

    activeIndex = target
    syncSlidePositions()
    syncDots()
  }

  // --- autoplay ---------------------------------------------------------------

  function clearTimer() {
    if (timerId === null) return
    window.clearTimeout(timerId)
    timerId = null
  }

  function clearSwipeClickSuppressTimer() {
    if (swipeClickSuppressTimer === null) return
    window.clearTimeout(swipeClickSuppressTimer)
    swipeClickSuppressTimer = null
  }

  function suppressNextClick() {
    root.dataset.swiping = '1'
    clearSwipeClickSuppressTimer()
    swipeClickSuppressTimer = window.setTimeout(() => {
      delete root.dataset.swiping
      swipeClickSuppressTimer = null
    }, 700)
  }

  function scheduleAutoplay(delay = SLIDE_INTERVAL_MS) {
    clearTimer()
    if (reducedMotionMedia.matches || document.hidden) return
    delete root.dataset.paused
    timerId = window.setTimeout(() => {
      goTo(activeIndex + 1)
      scheduleAutoplay()
    }, delay)
    if (delay === SLIDE_INTERVAL_MS) restartDotProgress()
  }

  function pauseAutoplay() {
    clearTimer()
    root.dataset.paused = '1'
  }

  // After a deliberate interaction, hold a beat before autoplay resumes.
  function restartAutoplay() {
    pauseAutoplay()
    scheduleAutoplay(INTERACTION_PAUSE_MS)
    restartDotProgress()
    delete root.dataset.paused
  }

  // --- pointer / touch ----------------------------------------------------------

  function handlePointerEnter(event) {
    if (event.pointerType === 'touch') return
    pauseAutoplay()
  }

  function handlePointerLeave(event) {
    if (event.pointerType === 'touch') return
    scheduleAutoplay()
  }

  function endDrag() {
    dragging = false
    delete root.dataset.dragging
    root.style.removeProperty('--drag')
  }

  function handleTouchStart(event) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    touchStartTime = event.timeStamp
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
      pauseAutoplay()
    }

    if (reducedMotionMedia.matches) return
    root.style.setProperty('--drag', `${deltaX}px`)
  }

  function handleTouchEnd(event) {
    const wasDragging = dragging
    endDrag()

    const touch = event.changedTouches[0]
    if (!touch || !wasDragging) {
      if (wasDragging) scheduleAutoplay()
      return
    }

    const deltaX = touch.clientX - touchStartX
    const elapsed = Math.max(event.timeStamp - touchStartTime, 1)
    const velocity = Math.abs(deltaX) / elapsed

    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX || velocity >= SWIPE_VELOCITY_PX_MS) {
      suppressNextClick()
      goTo(activeIndex + (deltaX < 0 ? 1 : -1))
    }

    scheduleAutoplay(INTERACTION_PAUSE_MS)
    restartDotProgress()
  }

  // A swipe that changed slides must not also follow the link.
  function handleClick(event) {
    if (root.dataset.swiping !== '1') return
    event.preventDefault()
    clearSwipeClickSuppressTimer()
    delete root.dataset.swiping
  }

  function handleKeydown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    goTo(activeIndex + (event.key === 'ArrowLeft' ? -1 : 1))
    restartAutoplay()
  }

  function handleFocusOut(event) {
    if (event.relatedTarget && root.contains(event.relatedTarget)) return
    scheduleAutoplay()
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      pauseAutoplay()
      return
    }
    scheduleAutoplay()
  }

  function handleReducedMotionChange(event) {
    if (event.matches) {
      pauseAutoplay()
      stopDotProgress()
      return
    }
    scheduleAutoplay()
  }

  buildControls()
  syncSlidePositions()
  syncDots()

  root.addEventListener('pointerenter', handlePointerEnter)
  root.addEventListener('pointerleave', handlePointerLeave)
  root.addEventListener('focusin', pauseAutoplay)
  root.addEventListener('focusout', handleFocusOut)
  root.addEventListener('keydown', handleKeydown)
  link.addEventListener('touchstart', handleTouchStart, { passive: true })
  link.addEventListener('touchmove', handleTouchMove, { passive: true })
  link.addEventListener('touchend', handleTouchEnd)
  link.addEventListener('touchcancel', endDrag)
  link.addEventListener('click', handleClick)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  reducedMotionMedia.addEventListener('change', handleReducedMotionChange)

  scheduleAutoplay()

  return {
    destroy() {
      clearTimer()
      clearSwipeClickSuppressTimer()
      resizeObserver?.disconnect()
      root.removeEventListener('pointerenter', handlePointerEnter)
      root.removeEventListener('pointerleave', handlePointerLeave)
      root.removeEventListener('focusin', pauseAutoplay)
      root.removeEventListener('focusout', handleFocusOut)
      root.removeEventListener('keydown', handleKeydown)
      link.removeEventListener('touchstart', handleTouchStart)
      link.removeEventListener('touchmove', handleTouchMove)
      link.removeEventListener('touchend', handleTouchEnd)
      link.removeEventListener('touchcancel', endDrag)
      link.removeEventListener('click', handleClick)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      reducedMotionMedia.removeEventListener('change', handleReducedMotionChange)
      controls.forEach(control => control.remove())
      root.style.removeProperty('--carousel-w')
      root.style.removeProperty('--drag')
      delete root.dataset.dragging
      delete root.dataset.paused
      delete root.dataset.swiping
    }
  }
}
