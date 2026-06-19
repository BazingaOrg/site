let tracker = null
let loadPromise = null
let disabled = false
const pendingEvents = []

export function trackUmami(eventName, data = {}, options = {}) {
  if (tracker) {
    tracker(eventName, data, options)
    return
  }

  if (disabled) return

  pendingEvents.push([eventName, data, options])
  loadTracker()
}

function loadTracker() {
  if (loadPromise || disabled) return

  loadPromise = import('./umami.js')
    .then(module => {
      if (typeof module.trackUmami !== 'function') {
        disabled = true
        pendingEvents.length = 0
        return
      }

      tracker = module.trackUmami
      pendingEvents.splice(0).forEach(args => tracker(...args))
    })
    .catch(() => {
      disabled = true
      pendingEvents.length = 0
    })
}

loadTracker()
