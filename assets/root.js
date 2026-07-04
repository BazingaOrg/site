import { trackUmami } from './events.js'

const isChineseInterface = document.documentElement.lang?.startsWith('zh')

function settime() {
  const timestamp = document.querySelector('[data-timestamp-text]')
  if (!timestamp || !('Intl' in window)) return

  const options = {
    timeZone: "Asia/Shanghai",
    timeStyle: "short",
    hour12: false
  }

  // https://gist.github.com/muan/e7414b6241f088090acd916ed965540e
  let time = new Intl.DateTimeFormat(navigator.language || "zh-CN", options).format(new Date())

  // Setting interpolated string instead of just the time because
  // if there's no JS there should be no mentions of current time
  const text = timestamp.getAttribute('data-timestamp-text').replace('{time}', time)
  timestamp.innerHTML = text.replace(':', '<span class="timestamp-colon" data-colon>:</span>')

  const now = new Date()
  const sec = now.getSeconds()
  const secondIsEven = sec % 2 === 0
  const colon = document.querySelector('[data-colon]')
  if (colon) colon.style.animationDelay = `${(secondIsEven ? 0 : 1000) - now.getMilliseconds()}ms`

  const delay = 60000 - ((sec * 1000) + now.getMilliseconds())
  setTimeout(settime, delay)
}

settime()

// Language preference memory functionality
function initLanguageMemory() {
  const STORAGE_KEY = 'site-language-preference'
  const currentPath = window.location.pathname
  const isHomepage = currentPath === '/' || currentPath === '/zh-CN/'
  const isChineseHomepage = currentPath === '/zh-CN/'
  const isEnglishHomepage = currentPath === '/'
  
  // Enhanced function to detect browser preferred language with better accuracy
  function getBrowserPreferredLanguage() {
    // Get all browser languages in preference order
    const browserLanguages = navigator.languages || [navigator.language || navigator.userLanguage || 'en-US']
    
    // Check each language in order of preference
    for (const lang of browserLanguages) {
      // Normalize language code
      const normalizedLang = lang.toLowerCase()
      
      // Check for Chinese variants (Simplified, Traditional, regional)
      if (normalizedLang.startsWith('zh-cn') ||     // Simplified Chinese (China)
          normalizedLang.startsWith('zh-sg') ||     // Simplified Chinese (Singapore)  
          normalizedLang.startsWith('zh-hans') ||   // Simplified Chinese
          normalizedLang === 'zh') {                // Generic Chinese (assume Simplified)
        return 'zh-CN'
      }
      
      // Check for Traditional Chinese (prefer English over Traditional for this site)
      if (normalizedLang.startsWith('zh-tw') ||     // Traditional Chinese (Taiwan)
          normalizedLang.startsWith('zh-hk') ||     // Traditional Chinese (Hong Kong)
          normalizedLang.startsWith('zh-mo') ||     // Traditional Chinese (Macau)
          normalizedLang.startsWith('zh-hant')) {   // Traditional Chinese
        return 'en-US'
      }
    }
    
    return 'en-US'
  }
  
  // Enhanced first-time visit detection
  function isFirstTimeVisitor() {
    return !localStorage.getItem(STORAGE_KEY) && !sessionStorage.getItem('visited-before')
  }
  
  // Mark user as having visited the site
  function markAsVisited() {
    sessionStorage.setItem('visited-before', 'true')
  }
  
  // Check if user has been redirected to avoid infinite loops
  const hasBeenRedirected = sessionStorage.getItem('language-redirected')
  
  // Enhanced auto-redirect logic for first-time visitors
  if (!hasBeenRedirected && isHomepage) {
    const savedLanguage = localStorage.getItem(STORAGE_KEY)
    
    if (isFirstTimeVisitor()) {
      // First-time visitor: use browser language detection
      const browserPreferredLanguage = getBrowserPreferredLanguage()
      
      markAsVisited()
      
      if (browserPreferredLanguage === 'zh-CN' && currentPath === '/') {
        trackUmami('language_autoredirect', {
          reason: 'browser_preference',
          detected_language: browserPreferredLanguage,
          from_path: currentPath,
          to_path: '/zh-CN/'
        })
        sessionStorage.setItem('language-redirected', 'true')
        setTimeout(() => {
          window.location.href = '/zh-CN/'
        }, 0)
        return
      } else if (browserPreferredLanguage === 'en-US' && currentPath === '/zh-CN/') {
        trackUmami('language_autoredirect', {
          reason: 'browser_preference',
          detected_language: browserPreferredLanguage,
          from_path: currentPath,
          to_path: '/'
        })
        sessionStorage.setItem('language-redirected', 'true')
        setTimeout(() => {
          window.location.href = '/'
        }, 0)
        return
      }
    } else if (savedLanguage) {
      if (savedLanguage === 'zh-CN' && currentPath === '/') {
        trackUmami('language_autoredirect', {
          reason: 'saved_preference',
          saved_language: savedLanguage,
          from_path: currentPath,
          to_path: '/zh-CN/'
        })
        sessionStorage.setItem('language-redirected', 'true')
        setTimeout(() => {
          window.location.href = '/zh-CN/'
        }, 0)
        return
      } else if (savedLanguage === 'en-US' && currentPath === '/zh-CN/') {
        trackUmami('language_autoredirect', {
          reason: 'saved_preference',
          saved_language: savedLanguage,
          from_path: currentPath,
          to_path: '/'
        })
        sessionStorage.setItem('language-redirected', 'true')
        setTimeout(() => {
          window.location.href = '/'
        }, 0)
        return
      }
    }
  }
  
  // Save current language preference based on current page
  if (isChineseHomepage) {
    localStorage.setItem(STORAGE_KEY, 'zh-CN')
  } else if (isEnglishHomepage) {
    localStorage.setItem(STORAGE_KEY, 'en-US')
  }
  
  // Add click event listeners to language switcher links
  const langSwitcher = document.querySelector('.lang')
  if (langSwitcher) {
    const langLinks = langSwitcher.querySelectorAll('a')
    
    langLinks.forEach(link => {
      link.addEventListener('click', function() {
        // Clear the redirect flag so next visit respects the new choice
        sessionStorage.removeItem('language-redirected')
        
        // Save the language preference based on the clicked link
        const targetHref = this.getAttribute('href')
        if (targetHref === '/zh-CN/') {
          localStorage.setItem(STORAGE_KEY, 'zh-CN')
        } else if (targetHref === '/') {
          localStorage.setItem(STORAGE_KEY, 'en-US')
        }
      })
    })
  }
}

// Write entry visibility control
function initWriteEntryControl() {
  const headings = Array.from(document.querySelectorAll('.normal-heading'))

  const logEntryToggle = (entry, action) => {
    trackUmami('write_entry_toggle', {
      entry,
      action,
      language: document.documentElement.lang || 'en-US',
      current_page: window.location.pathname
    })
  }

  function resolveHeadings(candidates) {
    return headings.filter(heading => candidates.includes(heading.textContent.trim()))
  }

  function bindTitleInteractions(targetHeadings, onToggle, updateTitleHint) {
    targetHeadings.forEach(targetHeading => {
      targetHeading.addEventListener('dblclick', event => {
        event.preventDefault()
        onToggle()
      })

      let pressTimer = null
      let isLongPress = false

      targetHeading.addEventListener('touchstart', event => {
        isLongPress = false
        pressTimer = setTimeout(() => {
          isLongPress = true
          event.preventDefault()
          onToggle()
        }, 1500)
      })

      targetHeading.addEventListener('touchend', event => {
        clearTimeout(pressTimer)
        if (isLongPress) {
          event.preventDefault()
        }
      })

      targetHeading.addEventListener('touchmove', () => {
        clearTimeout(pressTimer)
      })

      targetHeading.style.cursor = 'pointer'
      updateTitleHint(targetHeading)
    })
  }

  function createWriteEntryController(config) {
    const {
      entryId,
      storageKey,
      headingTexts,
      activeTitle,
      inactiveTitle,
      activeMessage,
      inactiveMessage,
      trackingEntry
    } = config

    const entryElement = document.getElementById(entryId)
    if (!entryElement) return

    const targetHeadings = resolveHeadings(headingTexts)
    if (targetHeadings.length === 0) return

    if (localStorage.getItem(storageKey) === 'true') {
      entryElement.classList.add('show')
    }

    const updateTitleHint = titleElement => {
      const isActive = localStorage.getItem(storageKey) === 'true'
      const isMobile = window.innerWidth <= 768
      const action = isChineseInterface
        ? (isMobile ? '长按' : '双击')
        : (isMobile ? 'long press' : 'double-click')
      titleElement.title = isActive ? `${action}${activeTitle}` : `${action}${inactiveTitle}`
    }

    const activateEntry = () => {
      entryElement.classList.add('show')
      localStorage.setItem(storageKey, 'true')
      entryElement.style.animation = 'writeEntryAppear 0.6s ease-out'
      showToast(activeMessage, 'success')
      logEntryToggle(trackingEntry, 'show')
    }

    const hideEntry = () => {
      entryElement.style.animation = 'writeEntryDisappear 0.4s ease-in'
      setTimeout(() => {
        entryElement.classList.remove('show')
        localStorage.setItem(storageKey, 'false')
      }, 400)
      showToast(inactiveMessage, 'info')
      logEntryToggle(trackingEntry, 'hide')
    }

    const toggleEntry = () => {
      if (entryElement.classList.contains('show')) {
        hideEntry()
      } else {
        activateEntry()
      }
      targetHeadings.forEach(updateTitleHint)
    }

    bindTitleInteractions(targetHeadings, toggleEntry, updateTitleHint)
  }

  createWriteEntryController({
    entryId: 'write-entry',
    storageKey: 'show-write-entry',
    headingTexts: ['Notes', '随笔'],
    activeTitle: isChineseInterface ? '隐藏随笔入口' : 'hide note entry',
    inactiveTitle: isChineseInterface ? '激活随笔入口' : 'activate note entry',
    activeMessage: isChineseInterface ? '随笔入口已激活' : 'Note entry enabled',
    inactiveMessage: isChineseInterface ? '随笔入口已隐藏' : 'Note entry hidden',
    trackingEntry: 'notes'
  })

  createWriteEntryController({
    entryId: 'photo-write-entry',
    storageKey: 'show-photo-entry',
    headingTexts: ['Photos', '照片'],
    activeTitle: isChineseInterface ? '隐藏上传入口' : 'hide upload entry',
    inactiveTitle: isChineseInterface ? '激活照片上传' : 'activate photo upload',
    activeMessage: isChineseInterface ? '照片上传已激活' : 'Photo upload enabled',
    inactiveMessage: isChineseInterface ? '照片上传已隐藏' : 'Photo upload hidden',
    trackingEntry: 'photos'
  })

  createWriteEntryController({
    entryId: 'post-write-entry',
    storageKey: 'show-post-entry',
    headingTexts: ['Posts', '长文'],
    activeTitle: isChineseInterface ? '隐藏长文入口' : 'hide post entry',
    inactiveTitle: isChineseInterface ? '激活长文入口' : 'activate post entry',
    activeMessage: isChineseInterface ? '长文入口已激活' : 'Post entry enabled',
    inactiveMessage: isChineseInterface ? '长文入口已隐藏' : 'Post entry hidden',
    trackingEntry: 'posts'
  })

  function showToast(message, type) {
    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.textContent = message

    document.body.appendChild(toast)

    // Show animation
    requestAnimationFrame(() => {
      toast.classList.add('show')
    })

    // Auto hide after 2 seconds
    setTimeout(() => {
      toast.classList.remove('show')
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast)
        }
      }, 300)
    }, 2000)
  }
}

// Initialize write-entry controller after language memory setup
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLanguageMemory()
    initWriteEntryControl()
  })
} else {
  initLanguageMemory()
  initWriteEntryControl()
}
