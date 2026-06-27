// Drives the homepage "now" line: a styled tooltip that names the focused app
// behind the frontmost badge, and a live state word ("in focus" / "away") that
// tracks whether the badge is online.
//
// The badge hides its own name/meta on this site, so the icon alone carries the
// meaning. This restores it: the tooltip spells out the app, and the state word
// gives a glanceable online/away cue next to the icon.

const REFRESH_MS = 1000

// Reads the badge's live state. Prefers the attributes the widget reflects onto
// its host (data-status / data-app-name); falls back to its open shadow DOM so
// this keeps working against an older deployed widget.
function readBadgeState(badge) {
  let status = badge.dataset.status
  let name = badge.dataset.appName || ''

  if (!status) {
    const root = badge.shadowRoot
    const flag = root && root.querySelector('.frontmost')
    status = flag ? (flag.className.trim().split(/\s+/)[1] || 'offline') : 'offline'
    if (status === 'active') {
      const nameEl = root && root.querySelector('.name')
      name = nameEl ? nameEl.textContent.trim() : ''
    }
  }

  const isActive = status === 'active'
  return { isActive, name: isActive ? name : '' }
}

function createTooltip() {
  const tip = document.createElement('div')
  tip.className = 'frontmost-tip'
  tip.setAttribute('role', 'tooltip')
  tip.setAttribute('aria-hidden', 'true')
  document.body.appendChild(tip)
  return tip
}

export function initBioPresence() {
  const badge = document.querySelector('.bio-now frontmost-badge')
  const stateEl = document.querySelector('.bio-now .bio-now-state')
  if (!badge) return

  const offlineLabel = badge.dataset.tipOffline || 'Away'
  const tip = createTooltip()
  let tipVisible = false

  function currentLabel() {
    const { isActive, name } = readBadgeState(badge)
    if (isActive) return name || ''
    return offlineLabel
  }

  function syncStateWord() {
    if (!stateEl) return
    const { isActive } = readBadgeState(badge)
    const next = isActive
      ? (stateEl.dataset.stateActive || '')
      : (stateEl.dataset.stateOffline || '')
    if (stateEl.textContent !== next) stateEl.textContent = next
  }

  function syncAccessibleName() {
    const label = currentLabel()
    if (label) badge.setAttribute('aria-label', label)
    else badge.removeAttribute('aria-label')
  }

  function positionTip() {
    const rect = badge.getBoundingClientRect()
    tip.style.left = `${window.scrollX + rect.left + rect.width / 2}px`
    tip.style.top = `${window.scrollY + rect.top}px`
  }

  function showTip() {
    const label = currentLabel()
    if (!label) return
    tip.textContent = label
    positionTip()
    tip.classList.add('is-visible')
    tip.setAttribute('aria-hidden', 'false')
    tipVisible = true
  }

  function hideTip() {
    tip.classList.remove('is-visible')
    tip.setAttribute('aria-hidden', 'true')
    tipVisible = false
  }

  // Keyboard reachable, and announced via the synced aria-label.
  badge.tabIndex = 0
  badge.addEventListener('mouseenter', showTip)
  badge.addEventListener('mouseleave', hideTip)
  badge.addEventListener('focus', showTip)
  badge.addEventListener('blur', hideTip)
  window.addEventListener('scroll', () => { if (tipVisible) positionTip() }, { passive: true })
  window.addEventListener('resize', () => { if (tipVisible) positionTip() })

  function tick() {
    syncStateWord()
    syncAccessibleName()
    if (tipVisible) {
      const label = currentLabel()
      if (label) tip.textContent = label
      else hideTip()
    }
  }

  tick()
  window.setInterval(tick, REFRESH_MS)
}
