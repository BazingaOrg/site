// Homepage photo carousel — direction-aware slide track.
//
// Model: the active photo sits flush left (aligned with the section
// headings); its neighbours wait just outside the stage (positioned via
// --slide-x in CSS). Advancing slides the row along the gesture axis, so
// motion always tells you which way you went. Controls live in a compact
// `‹ dots ›` row under the photo — injected here so the no-JS fallback
// stays a plain link showing the first photo.

const SLIDE_INTERVAL_MS = 4500
const SWIPE_THRESHOLD_PX = 40
// Flick detection uses the velocity of the last ~120ms of the gesture, so a
// press-hold followed by a quick flick still pages, while slow long drags
// rely on the distance threshold alone.
const VELOCITY_WINDOW_MS = 120
const SWIPE_VELOCITY_PX_MS = 0.25
const SWIPE_FLICK_MIN_PX = 16
const SWIPE_CLICK_BACKSTOP_MS = 1500
const POSITION_CLASSES = ['is-active', 'is-prev', 'is-next']

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
  let pointerOver = false
  let focusWithin = false
  let dragging = false
  let touchStartX = 0
  let touchStartY = 0
  let dragSign = 0
  let moveSamples = []
  let swipeClickSuppressTimer = null

  // --- layout ---------------------------------------------------------------

  function syncStageWidth() {
    root.style.setProperty('--carousel-w', `${link.clientWidth}px`)
  }

  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(syncStageWidth) : null
  resizeObserver?.observe(link)
  syncStageWidth()
  // Single source of truth for the autoplay interval: the dot-progress
  // animation duration in CSS reads this variable.
  root.style.setProperty('--carousel-interval', `${SLIDE_INTERVAL_MS}ms`)

  // --- controls ---------------------------------------------------------------

  function arrowSvg(direction) {
    const points = direction === 'prev' ? '9.5,3.5 5,8 9.5,12.5' : '6.5,3.5 11,8 6.5,12.5'
    return `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"></polyline></svg>`
  }

  function buildControls() {
    const controlsRow = document.createElement('div')
    controlsRow.className = 'photo-carousel-controls'

    const makeArrow = direction => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `photo-carousel-arrow photo-carousel-arrow--${direction}`
      button.setAttribute('aria-label', direction === 'prev'
        ? (isChineseInterface ? '上一张照片' : 'Previous photo')
        : (isChineseInterface ? '下一张照片' : 'Next photo'))
      button.innerHTML = arrowSvg(direction)
      button.addEventListener('click', () => {
        goTo(activeIndex + (direction === 'prev' ? -1 : 1))
        scheduleAutoplay()
      })
      return button
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
        scheduleAutoplay()
      })
      dotsContainer.appendChild(dot)
      return dot
    })

    controlsRow.appendChild(makeArrow('prev'))
    controlsRow.appendChild(dotsContainer)
    controlsRow.appendChild(makeArrow('next'))
    root.appendChild(controlsRow)
    controls.push(controlsRow)
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
    slide.classList.remove(...POSITION_CLASSES)
    if (className) slide.classList.add(className)
    void slide.offsetWidth
    slide.classList.remove('is-snap')
  }

  // With exactly two slides the single neighbour cannot sit on both sides;
  // it parks on the side of the current/expected travel direction.
  function slideRoles(direction) {
    const roles = new Map([[activeIndex, 'is-active']])
    if (slides.length === 2) {
      roles.set(1 - activeIndex, direction < 0 ? 'is-next' : 'is-prev')
    } else {
      roles.set(normalizeIndex(activeIndex - 1, slides.length), 'is-prev')
      roles.set(normalizeIndex(activeIndex + 1, slides.length), 'is-next')
    }
    return roles
  }

  function syncSlidePositions(direction = 1) {
    const roles = slideRoles(direction)

    slides.forEach((slide, index) => {
      const role = roles.get(index)
      if (!role) {
        slide.classList.remove(...POSITION_CLASSES)
        return
      }

      // A newly recruited neighbour teleports to its waiting spot; a slide
      // that is animating (was active or already in this role) keeps its
      // transition.
      if (role !== 'is-active' && !slide.classList.contains('is-active') && !slide.classList.contains(role)) {
        snapTo(slide, role)
        return
      }

      slide.classList.remove(...POSITION_CLASSES.filter(name => name !== role))
      slide.classList.add(role)
    })
  }

  function goTo(index) {
    const target = normalizeIndex(index, slides.length)
    if (target === activeIndex) return

    // Pre-position the target on the side matching the travel direction so
    // it slides in naturally: always for two slides (the neighbour may be
    // parked on the wrong side), and for non-adjacent dot jumps.
    const forwardDistance = normalizeIndex(target - activeIndex, slides.length)
    const goingForward = forwardDistance <= slides.length / 2
    const isAdjacent = forwardDistance === 1 || forwardDistance === slides.length - 1
    const targetSlide = slides[target]
    const targetWaitClass = goingForward ? 'is-next' : 'is-prev'
    if ((slides.length === 2 || !isAdjacent) && !targetSlide.classList.contains(targetWaitClass)) {
      snapTo(targetSlide, targetWaitClass)
    }

    activeIndex = target
    syncSlidePositions(goingForward ? 1 : -1)
    syncDots()
  }

  // --- autoplay ---------------------------------------------------------------

  function clearTimer() {
    if (timerId === null) return
    window.clearTimeout(timerId)
    timerId = null
  }

  function canAutoplay() {
    return !pointerOver && !focusWithin && !dragging
      && !document.hidden && !reducedMotionMedia.matches
  }

  function scheduleAutoplay() {
    clearTimer()
    if (!canAutoplay()) {
      root.dataset.paused = '1'
      return
    }
    delete root.dataset.paused
    timerId = window.setTimeout(autoplayTick, SLIDE_INTERVAL_MS)
    restartDotProgress()
  }

  // Re-check at fire time: an interaction may have re-armed the timer while
  // the pointer or focus was still parked on the carousel.
  function autoplayTick() {
    timerId = null
    if (!canAutoplay()) {
      root.dataset.paused = '1'
      return
    }
    goTo(activeIndex + 1)
    scheduleAutoplay()
  }

  function pauseAutoplay() {
    clearTimer()
    root.dataset.paused = '1'
  }

  // --- pointer / touch ----------------------------------------------------------

  function handlePointerEnter(event) {
    if (event.pointerType === 'touch') return
    pointerOver = true
    pauseAutoplay()
  }

  function handlePointerLeave(event) {
    if (event.pointerType === 'touch') return
    pointerOver = false
    scheduleAutoplay()
  }

  function handleFocusIn() {
    focusWithin = true
    pauseAutoplay()
  }

  function handleFocusOut(event) {
    if (event.relatedTarget && root.contains(event.relatedTarget)) return
    // On window blur focusout fires with relatedTarget null while the
    // element keeps focus; the pause must survive until focus really moves.
    if (!document.hasFocus()) return
    focusWithin = false
    scheduleAutoplay()
  }

  function clearSwipeClickSuppressTimer() {
    if (swipeClickSuppressTimer === null) return
    window.clearTimeout(swipeClickSuppressTimer)
    swipeClickSuppressTimer = null
  }

  // The synthetic click after a page-changing swipe must not follow the
  // link. The click handler consumes the flag; the timer is only a backstop
  // for browsers that never dispatch that click.
  function suppressNextClick() {
    root.dataset.swiping = '1'
    clearSwipeClickSuppressTimer()
    swipeClickSuppressTimer = window.setTimeout(() => {
      delete root.dataset.swiping
      swipeClickSuppressTimer = null
    }, SWIPE_CLICK_BACKSTOP_MS)
  }

  function endDrag() {
    dragging = false
    dragSign = 0
    delete root.dataset.dragging
    root.style.removeProperty('--drag')
  }

  function handleTouchStart(event) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    dragging = false
    dragSign = 0
    moveSamples = [{ x: touch.clientX, t: event.timeStamp }]
    clearSwipeClickSuppressTimer()
    delete root.dataset.swiping
  }

  function handleTouchMove(event) {
    const touch = event.touches[0]
    if (!touch) return

    const deltaX = touch.clientX - touchStartX
    const deltaY = touch.clientY - touchStartY

    moveSamples.push({ x: touch.clientX, t: event.timeStamp })
    while (moveSamples.length > 1 && moveSamples[0].t < event.timeStamp - VELOCITY_WINDOW_MS) {
      moveSamples.shift()
    }

    // Wait until the gesture is clearly horizontal so vertical scroll is untouched.
    if (!dragging) {
      if (Math.abs(deltaX) < 8 || Math.abs(deltaX) <= Math.abs(deltaY)) return
      dragging = true
      root.dataset.dragging = '1'
      pauseAutoplay()
    }

    // Two slides: keep the single neighbour parked on the side the drag is
    // about to reveal, re-snapping if the drag direction flips.
    const sign = Math.sign(deltaX)
    if (slides.length === 2 && sign !== 0 && sign !== dragSign) {
      dragSign = sign
      snapTo(slides[1 - activeIndex], sign < 0 ? 'is-next' : 'is-prev')
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
    const windowStart = moveSamples[0] || { x: touchStartX, t: event.timeStamp }
    const recentDelta = touch.clientX - windowStart.x
    const recentElapsed = Math.max(event.timeStamp - windowStart.t, 1)
    const recentVelocity = Math.abs(recentDelta) / recentElapsed
    const isFlick = Math.abs(recentDelta) >= SWIPE_FLICK_MIN_PX
      && recentVelocity >= SWIPE_VELOCITY_PX_MS
      && Math.sign(recentDelta) === Math.sign(deltaX)

    if (Math.abs(deltaX) >= SWIPE_THRESHOLD_PX || isFlick) {
      suppressNextClick()
      goTo(activeIndex + (deltaX < 0 ? 1 : -1))
    }

    scheduleAutoplay()
  }

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
      // Return to the eagerly-loaded first photo so the frozen frame is
      // deterministic and already decoded.
      goTo(0)
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
  root.addEventListener('focusin', handleFocusIn)
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
      root.removeEventListener('focusin', handleFocusIn)
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
      root.style.removeProperty('--carousel-interval')
      root.style.removeProperty('--drag')
      delete root.dataset.dragging
      delete root.dataset.paused
      delete root.dataset.swiping
    }
  }
}
