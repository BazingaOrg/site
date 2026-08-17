        const photos = document.querySelector('#photos')
        const photosSiteHeader = document.querySelector('body[data-page-type="photos"] > header')
        // Range: 0 = Auto, 1..6 → columns 3..8
        const columnsSlider = document.querySelector('#photo-columns')
        const columnsValueEl = document.querySelector('#photo-columns-value')
        const columnsOpenBtn = document.querySelector('#photo-columns-open')
        const columnsPanel = document.querySelector('#photo-columns-panel')
        const COLUMNS_STORAGE_KEY = 'photos-columns'
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

        // Search and lightbox share one layout-stable scroll lock. Freezing the
        // body also prevents iOS Safari from scrolling the page behind a modal.
        const scrollLockOwners = new Set()
        let lockedScrollPosition = { x: 0, y: 0 }
        let bodyLockSnapshot = null
        let htmlOverflowSnapshot = ''

        const lockPageScroll = (owner) => {
          if (scrollLockOwners.has(owner)) return
          scrollLockOwners.add(owner)
          if (scrollLockOwners.size > 1) return

          lockedScrollPosition = { x: window.scrollX, y: window.scrollY }
          const bodyStyle = document.body.style
          bodyLockSnapshot = {
            position: bodyStyle.position,
            top: bodyStyle.top,
            left: bodyStyle.left,
            width: bodyStyle.width,
            boxSizing: bodyStyle.boxSizing,
            overflow: bodyStyle.overflow,
            paddingRight: bodyStyle.paddingRight
          }
          htmlOverflowSnapshot = document.documentElement.style.overflow

          const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
          const computedPaddingRight = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0
          Object.assign(bodyStyle, {
            position: 'fixed',
            top: `-${lockedScrollPosition.y}px`,
            left: `-${lockedScrollPosition.x}px`,
            width: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            paddingRight: `${computedPaddingRight + scrollbarWidth}px`
          })
          document.documentElement.style.overflow = 'hidden'
        }

        const unlockPageScroll = (owner) => {
          scrollLockOwners.delete(owner)
          if (scrollLockOwners.size > 0 || !bodyLockSnapshot) return

          Object.assign(document.body.style, bodyLockSnapshot)
          document.documentElement.style.overflow = htmlOverflowSnapshot
          bodyLockSnapshot = null
          window.scrollTo(lockedScrollPosition.x, lockedScrollPosition.y)
        }

        const syncPhotosStickyOffsets = () => {
          const headerH = photosSiteHeader
            ? Math.ceil(photosSiteHeader.getBoundingClientRect().height)
            : 0
          document.documentElement.style.setProperty('--photos-site-header-height', `${headerH}px`)
        }
        syncPhotosStickyOffsets()
        if (photosSiteHeader && typeof ResizeObserver !== 'undefined') {
          const stickyRo = new ResizeObserver(() => {
            syncPhotosStickyOffsets()
          })
          stickyRo.observe(photosSiteHeader)
        }
        window.addEventListener('resize', syncPhotosStickyOffsets, { passive: true })
        const COLUMN_STEPS = ['auto', '3', '4', '5', '6', '7', '8']
        const ALLOWED_COLUMNS = new Set(COLUMN_STEPS)
        // All gallery links (for click binding). Active strip/nav is album-scoped.
        const allPhotoLinks = Array.from(document.querySelectorAll('#photos .image-link'))
        let activePhotoLinks = allPhotoLinks
        const photoOverlay = document.querySelector('#photo-overlay')
        const photoOverlayImage = document.querySelector('#photo-overlay-image')
        const photoOverlayPosition = document.querySelector('#photo-overlay-position')
        const photoOverlayClose = document.querySelector('.photo-overlay-close')
        const photoOverlayToggleExif = document.querySelector('.photo-overlay-toggle-exif')
        const photoOverlayToggleThumbs = document.querySelector('.photo-overlay-toggle-thumbs')
        const photoOverlayToggleFullscreen = document.querySelector('.photo-overlay-toggle-fullscreen')
        const photoOverlayToggleAutoplay = document.querySelector('.photo-overlay-toggle-autoplay')
        const photoOverlayBody = document.querySelector('.photo-overlay-body')
        const photoOverlayStage = document.querySelector('.photo-overlay-stage')
        const photoOverlayLoading = document.querySelector('.photo-overlay-loading')
        const photoOverlayCaption = document.querySelector('#photo-overlay-caption')
        const photoOverlayCaptionContent = document.querySelector('#photo-overlay-caption-content')
        const photoOverlayExif = document.querySelector('#photo-overlay-exif')
        const photoOverlayExifRows = {
          camera: document.querySelector('#photo-overlay-exif-camera-row'),
          lens: document.querySelector('#photo-overlay-exif-lens-row'),
          settings: document.querySelector('#photo-overlay-exif-settings-row'),
          capturedAt: document.querySelector('#photo-overlay-exif-captured-at-row'),
          format: document.querySelector('#photo-overlay-exif-format-row'),
          range: document.querySelector('#photo-overlay-exif-range-row'),
          display: document.querySelector('#photo-overlay-exif-display-row'),
          fallback: document.querySelector('#photo-overlay-exif-fallback-row')
        }
        const photoOverlayExifValues = {
          camera: document.querySelector('#photo-overlay-exif-camera'),
          lens: document.querySelector('#photo-overlay-exif-lens'),
          settings: document.querySelector('#photo-overlay-exif-settings'),
          capturedAt: document.querySelector('#photo-overlay-exif-captured-at'),
          format: document.querySelector('#photo-overlay-exif-format'),
          range: document.querySelector('#photo-overlay-exif-range'),
          display: document.querySelector('#photo-overlay-exif-display'),
          fallback: document.querySelector('#photo-overlay-exif-fallback')
        }
        const photoOverlayThumbs = document.querySelector('#photo-overlay-thumbs')
        let currentPhotoIndex = -1
        let touchStartX = 0
        let touchEndX = 0
        let wheelSwitchLockedUntil = 0
        let overlayImageRequestToken = 0
        let autoplayTimerId = null
        let autoplayAnimationFrameId = null
        let autoplayStartedAt = 0
        let autoplayDuration = 4800
        let overlayVisibilityTimerId = null
        let thumbsAlbumKey = null
        let overlayTrigger = null

        const fullscreenApiSupported = Boolean(
          document.fullscreenEnabled
          && photoOverlay?.requestFullscreen
          && document.exitFullscreen
        )

        const albumLinksFor = (link) => {
          const album = link?.closest?.('.photo-album')
          if (!album) return allPhotoLinks
          return Array.from(album.querySelectorAll('.image-link'))
        }

        const columnsAutoLabel = () =>
          columnsSlider?.dataset?.autoLabel || columnsValueEl?.dataset?.autoLabel || 'Auto'

        const columnValueFromSlider = (raw) => {
          const index = Number(raw)
          if (!Number.isFinite(index) || index < 0) return 'auto'
          return COLUMN_STEPS[Math.min(COLUMN_STEPS.length - 1, Math.round(index))] || 'auto'
        }

        const sliderIndexFromColumn = (value) => {
          const index = COLUMN_STEPS.indexOf(value)
          return index >= 0 ? index : 0
        }

        const columnDisplayLabel = (value) => (value === 'auto' ? columnsAutoLabel() : value)

        const syncColumnsSliderUi = (value) => {
          const next = ALLOWED_COLUMNS.has(value) ? value : 'auto'
          const index = sliderIndexFromColumn(next)
          const label = columnDisplayLabel(next)
          if (columnsSlider) {
            if (String(columnsSlider.value) !== String(index)) {
              columnsSlider.value = String(index)
            }
            columnsSlider.dataset.resolved = next
            columnsSlider.setAttribute('aria-valuenow', String(index))
            columnsSlider.setAttribute('aria-valuetext', label)
            // Fill track progress for webkit (0..1)
            const max = Number(columnsSlider.max) || 6
            const progress = max > 0 ? (index / max) * 100 : 0
            columnsSlider.style.setProperty('--columns-progress', `${progress}%`)
          }
          if (columnsValueEl) {
            columnsValueEl.textContent = label
            columnsValueEl.value = label
          }
        }

        const applyPhotoColumns = (value) => {
          if (!photos) return
          const next = ALLOWED_COLUMNS.has(value) ? value : 'auto'
          photos.dataset.columns = next
          syncColumnsSliderUi(next)
        }

        let storedColumns = null
        try {
          storedColumns = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
        } catch {
          storedColumns = null
        }
        // Migrate legacy select values; default Auto
        applyPhotoColumns(storedColumns || 'auto')

        // Initialize collapsible captions
        document.querySelectorAll('.caption-container').forEach(container => {
          const content = container.querySelector('.caption-content')
          const toggle = container.querySelector('.caption-toggle')
          
          // Collapse captions only when they exceed roughly three lines.
          if (content.scrollHeight > parseFloat(getComputedStyle(content).fontSize) * 1.6 * 3) {
            container.classList.add('is-long')
            toggle.style.display = 'block'
            
            toggle.addEventListener('click', () => {
              const isExpanded = container.classList.contains('expanded')
              container.classList.toggle('expanded')
              toggle.textContent = isExpanded ? (container.dataset.expandLabel || 'Expand') : (container.dataset.collapseLabel || 'Collapse')
            })
          }
        });

        // Columns range: live update + persist on change
        const commitPhotoColumns = (rawIndex, { persist = false, track = false } = {}) => {
          const value = columnValueFromSlider(rawIndex)
          applyPhotoColumns(value)
          if (persist) {
            try {
              window.localStorage.setItem(COLUMNS_STORAGE_KEY, value)
            } catch {
              // ignore quota / private mode
            }
          }
          if (!track) return
          try {
            if (typeof window.umami === 'function') {
              window.umami('photos_layout_change', {
                layout: value,
                control_id: 'photo-columns',
                current_page: window.location.pathname,
                language: document.documentElement.lang || 'en-US'
              })
            } else if (window.umami?.track) {
              window.umami.track('photos_layout_change', {
                layout: value,
                control_id: 'photo-columns',
                current_page: window.location.pathname,
                language: document.documentElement.lang || 'en-US'
              })
            }
          } catch (error) {
            console.log('Umami tracking error:', error)
          }
        }

        columnsSlider?.addEventListener('input', () => {
          commitPhotoColumns(columnsSlider.value, { persist: false, track: false })
        })
        columnsSlider?.addEventListener('change', () => {
          commitPhotoColumns(columnsSlider.value, { persist: true, track: true })
        })

        const positionColumnsPanel = () => {
          if (!columnsPanel || !columnsOpenBtn || columnsPanel.hidden) return
          const rect = columnsOpenBtn.getBoundingClientRect()
          const panelWidth = columnsPanel.offsetWidth || 288
          const gap = 8
          let left = rect.right - panelWidth
          left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12))
          const top = Math.min(rect.bottom + gap, window.innerHeight - 12)
          columnsPanel.style.left = `${Math.round(left)}px`
          columnsPanel.style.top = `${Math.round(top)}px`
        }

        const setColumnsPanelOpen = (open) => {
          if (!columnsPanel || !columnsOpenBtn) return
          columnsPanel.hidden = !open
          columnsOpenBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
          if (open) {
            positionColumnsPanel()
            columnsSlider?.focus({ preventScroll: true })
          }
        }

        columnsOpenBtn?.addEventListener('click', (event) => {
          event.stopPropagation()
          setColumnsPanelOpen(Boolean(columnsPanel?.hidden))
        })

        document.addEventListener('click', (event) => {
          if (!columnsPanel || columnsPanel.hidden) return
          if (columnsPanel.contains(event.target) || columnsOpenBtn?.contains(event.target)) return
          setColumnsPanelOpen(false)
        })

        window.addEventListener('resize', () => {
          if (!columnsPanel?.hidden) positionColumnsPanel()
        }, { passive: true })

        // Search dialog (afilmory-like icon → modal)
        const searchOpenBtn = document.querySelector('#photo-search-open')
        const searchDialog = document.querySelector('#photo-search-dialog')
        const searchInput = document.querySelector('#photo-search-input')
        const searchClear = document.querySelector('.photo-search-clear')
        const searchResults = document.querySelector('#photo-search-results')
        const searchStatus = document.querySelector('#photo-search-status')
        let shouldRestoreSearchFocus = true
        let searchIndex = Array.from(document.querySelectorAll('#photos figure[data-photo-search]')).map((figure) => {
          const title = figure.dataset.photoTitle || figure.dataset.photoLabel || figure.id
          const subtitle = figure.dataset.photoSubtitle || ''
          const thumb =
            figure.dataset.photoThumb
            || figure.querySelector('img')?.currentSrc
            || figure.querySelector('img')?.src
            || ''
          return {
            id: figure.id,
            slug: photos?.dataset?.albumSlug || '',
            text: (figure.dataset.photoSearch || '').toLowerCase(),
            title,
            subtitle,
            thumb,
            label: figure.dataset.photoLabel || [title, subtitle].filter(Boolean).join(' · ')
          }
        })

        const mergeSearchItems = (items) => {
          if (!Array.isArray(items)) return
          const byId = new Map(searchIndex.map((item) => [item.id, item]))
          items.forEach((item) => {
            if (!item?.id) return
            const current = byId.get(item.id)
            if (current) {
              if (item.slug && !current.slug) current.slug = item.slug
              return
            }
            searchIndex.push(item)
            byId.set(item.id, item)
          })
        }

        let searchIndexPromise = null
        const ensureRemoteSearchIndex = () => {
          if (searchIndexPromise) return searchIndexPromise
          searchIndexPromise = fetch('/photos/search.json')
            .then((response) => (response.ok ? response.json() : []))
            .then((items) => {
              mergeSearchItems(items)
            })
            .catch(() => {})
          return searchIndexPromise
        }

        const clearPhotoSearch = () => {
          if (searchInput) searchInput.value = ''
          if (searchResults) {
            searchResults.hidden = true
            searchResults.innerHTML = ''
          }
          if (searchStatus) searchStatus.textContent = ''
          if (searchClear) searchClear.hidden = true
        }

        const setSearchScrollLock = (locked) => {
          if (locked) lockPageScroll('search')
          document.documentElement.classList.toggle('photo-search-open', locked)
          document.body.classList.toggle('photo-search-open', locked)
          if (!locked) unlockPageScroll('search')
        }

        const closeSearchDialog = () => {
          if (searchDialog?.open) {
            searchDialog.close()
          } else if (searchDialog?.hasAttribute('open')) {
            searchDialog.removeAttribute('open')
          }
          setSearchScrollLock(false)
        }

        const openSearchDialog = () => {
          ensureRemoteSearchIndex()
          setColumnsPanelOpen(false)
          if (!searchDialog) return
          shouldRestoreSearchFocus = true
          if (typeof searchDialog.showModal === 'function') {
            if (!searchDialog.open) searchDialog.showModal()
          } else {
            searchDialog.setAttribute('open', '')
          }
          setSearchScrollLock(true)
          window.setTimeout(() => {
            searchInput?.focus()
            searchInput?.select?.()
          }, 0)
        }

        // Prevent wheel/touch on the dimmed backdrop from scrolling the page.
        const blockBackgroundScroll = (event) => {
          if (!document.documentElement.classList.contains('photo-search-open')) return
          const path = typeof event.composedPath === 'function' ? event.composedPath() : []
          const inDialog = path.includes(searchDialog) || searchDialog?.contains(event.target)
          if (!inDialog) {
            event.preventDefault()
          }
        }
        window.addEventListener('wheel', blockBackgroundScroll, { passive: false })
        window.addEventListener('touchmove', blockBackgroundScroll, { passive: false })

        const albumPathFor = (item) => {
          const slug = item?.slug || photos?.dataset?.albumSlug
          return slug ? `/photos/${slug}/` : '/photos/'
        }

        const jumpToPhotoResult = (photoId) => {
          shouldRestoreSearchFocus = false
          closeSearchDialog()
          const target = document.getElementById(photoId)
          if (target) {
            target.scrollIntoView({
              behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
              block: 'start'
            })
            if (typeof target.focus === 'function') {
              try {
                target.setAttribute('tabindex', '-1')
                target.focus({ preventScroll: true })
              } catch {
                // ignore focus errors
              }
            }
            return
          }

          const item = searchIndex.find((entry) => entry.id === photoId)
          if (!item) return
          window.location.href = `${albumPathFor(item)}#${photoId}`
        }

        const runPhotoSearch = (rawQuery) => {
          if (!searchResults || !searchStatus) return

          const query = rawQuery.trim().toLowerCase()
          if (!query) {
            clearPhotoSearch()
            if (searchInput) searchInput.value = ''
            return
          }

          if (searchClear) searchClear.hidden = false

          const matches = []
          for (const item of searchIndex) {
            if (item.text.includes(query)) {
              matches.push(item)
              if (matches.length >= 10) break
            }
          }

          searchResults.innerHTML = ''
          if (matches.length === 0) {
            searchResults.hidden = true
            searchStatus.textContent = searchStatus.dataset.noResults || 'No matches'
            return
          }

          const fragment = document.createDocumentFragment()
          matches.forEach((item) => {
            const li = document.createElement('li')
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'photo-search-result'
            button.title = item.label
            button.setAttribute('aria-label', item.label)

            const thumbWrap = document.createElement('span')
            thumbWrap.className = 'photo-search-result-thumb'
            thumbWrap.setAttribute('aria-hidden', 'true')
            if (item.thumb) {
              const thumbImg = document.createElement('img')
              thumbImg.src = item.thumb
              thumbImg.alt = ''
              thumbImg.loading = 'lazy'
              thumbImg.decoding = 'async'
              thumbWrap.appendChild(thumbImg)
            }

            const textWrap = document.createElement('span')
            textWrap.className = 'photo-search-result-text'

            const titleEl = document.createElement('span')
            titleEl.className = 'photo-search-result-title'
            titleEl.textContent = item.title

            textWrap.appendChild(titleEl)
            if (item.subtitle) {
              const subEl = document.createElement('span')
              subEl.className = 'photo-search-result-sub'
              subEl.textContent = item.subtitle
              textWrap.appendChild(subEl)
            }

            button.appendChild(thumbWrap)
            button.appendChild(textWrap)
            button.addEventListener('click', () => jumpToPhotoResult(item.id))

            li.appendChild(button)
            fragment.appendChild(li)
          })
          searchResults.appendChild(fragment)
          searchResults.hidden = false
          const capped = matches.length >= 10
          const resultCount = capped ? '10+' : String(matches.length)
          const resultLabel = !capped && matches.length === 1
            ? (searchStatus.dataset.resultLabel || 'result')
            : (searchStatus.dataset.resultsLabel || 'results')
          searchStatus.textContent = `${resultCount} ${resultLabel}`
        }

        searchOpenBtn?.addEventListener('click', () => {
          ensureRemoteSearchIndex()
          openSearchDialog()
        })

        searchInput?.addEventListener('input', () => {
          runPhotoSearch(searchInput.value)
        })

        searchClear?.addEventListener('click', () => {
          clearPhotoSearch()
          searchInput?.focus()
        })

        searchDialog?.addEventListener('close', () => {
          clearPhotoSearch()
          setSearchScrollLock(false)
          if (shouldRestoreSearchFocus) {
            searchOpenBtn?.focus({ preventScroll: true })
          }
        })
        // / or Cmd/Ctrl+K opens search on photos page
        document.addEventListener('keydown', (event) => {
          if (!searchOpenBtn) return
          const target = event.target
          const tag = target?.tagName
          const typing =
            tag === 'INPUT'
            || tag === 'TEXTAREA'
            || tag === 'SELECT'
            || target?.isContentEditable
          if (typing) return

          const metaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
          const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey
          if (!metaK && !slash) return
          event.preventDefault()
          openSearchDialog()
        })

        document.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') return
          if (columnsPanel && !columnsPanel.hidden) {
            setColumnsPanelOpen(false)
          }
        })

        const buildOverlayThumbnails = () => {
          if (!photoOverlayThumbs) return

          const fragment = document.createDocumentFragment()
          activePhotoLinks.forEach((link, index) => {
            const sourceImage = link.querySelector('img')
            const thumbnailButton = document.createElement('button')
            thumbnailButton.type = 'button'
            thumbnailButton.className = 'photo-overlay-thumb'
            thumbnailButton.setAttribute('aria-label', `${photoOverlayThumbs.dataset.viewLabel || 'View photo'} ${index + 1}`)
            thumbnailButton.dataset.photoIndex = `${index}`

            const thumbnailImage = document.createElement('img')
            thumbnailImage.src = photoThumbnailSrc(link, sourceImage)
            thumbnailImage.alt = sourceImage?.alt || `Photo ${index + 1}`
            thumbnailImage.loading = 'lazy'
            thumbnailImage.decoding = 'async'
            thumbnailButton.appendChild(thumbnailImage)

            thumbnailButton.addEventListener('click', () => {
              updateOverlay(index)
            })

            fragment.appendChild(thumbnailButton)
          })

          photoOverlayThumbs.innerHTML = ''
          photoOverlayThumbs.appendChild(fragment)
        }

        const updateThumbnailActiveState = (photoIndex) => {
          if (!photoOverlayThumbs) return

          photoOverlayThumbs.querySelectorAll('.photo-overlay-thumb').forEach((thumbnail, index) => {
            const isActive = index === photoIndex
            thumbnail.classList.toggle('is-active', isActive)
            thumbnail.setAttribute('aria-current', isActive ? 'true' : 'false')
          })

          const activeThumbnail = photoOverlayThumbs.querySelector('.photo-overlay-thumb.is-active')
          activeThumbnail?.scrollIntoView({ block: 'nearest', inline: 'center' })
        }

        const setOverlayLoadingState = (isLoading) => {
          photoOverlayStage?.classList.toggle('is-loading', isLoading)
          if (photoOverlayLoading) {
            photoOverlayLoading.hidden = !isLoading
          }
        }

        const setOverlayImage = (fullSource, altText, { placeholderSource = null } = {}) => {
          if (!photoOverlayImage) return

          overlayImageRequestToken += 1
          const requestToken = overlayImageRequestToken
          const fullUrl = fullSource || ''
          const placeholderUrl =
            placeholderSource
            && placeholderSource !== fullUrl
              ? placeholderSource
              : null

          setOverlayLoadingState(true)
          photoOverlayImage.alt = altText || ''

          const markReady = () => {
            if (requestToken !== overlayImageRequestToken) return
            setOverlayLoadingState(false)
          }

          const loadFull = () => {
            if (requestToken !== overlayImageRequestToken) return
            if (!fullUrl) {
              setOverlayLoadingState(false)
              return
            }

            // Already showing the full asset (placeholder same as full).
            if (photoOverlayImage.src === fullUrl || photoOverlayImage.getAttribute('src') === fullUrl) {
              markReady()
              return
            }

            const probe = new Image()
            probe.decoding = 'async'
            probe.onload = () => {
              if (requestToken !== overlayImageRequestToken) return
              photoOverlayImage.src = fullUrl
              markReady()
            }
            probe.onerror = () => {
              if (requestToken !== overlayImageRequestToken) return
              // Keep placeholder if full resolution fails.
              setOverlayLoadingState(false)
            }
            probe.src = fullUrl

            if (probe.complete) {
              probe.onload?.()
            }
          }

          photoOverlayImage.onload = null
          photoOverlayImage.onerror = null

          if (placeholderUrl) {
            photoOverlayImage.onload = () => {
              if (requestToken !== overlayImageRequestToken) return
              // Placeholder visible; still loading full in background.
              loadFull()
            }
            photoOverlayImage.onerror = () => {
              if (requestToken !== overlayImageRequestToken) return
              loadFull()
            }
            photoOverlayImage.src = placeholderUrl
            if (photoOverlayImage.complete) {
              photoOverlayImage.onload?.()
            }
            return
          }

          photoOverlayImage.onload = markReady
          photoOverlayImage.onerror = () => {
            if (requestToken !== overlayImageRequestToken) return
            setOverlayLoadingState(false)
          }
          photoOverlayImage.src = fullUrl
          if (photoOverlayImage.complete) {
            markReady()
          }
        }

        const setAutoplayProgress = (progress) => {
          if (!photoOverlayToggleAutoplay) return
          const clampedProgress = Math.min(1, Math.max(0, progress))
          photoOverlayToggleAutoplay.style.setProperty('--autoplay-progress', `${clampedProgress}`)
        }

        const syncAutoplayButtonState = (isPlaying) => {
          if (!photoOverlayToggleAutoplay) return
          photoOverlayToggleAutoplay.classList.toggle('is-playing', isPlaying)
          photoOverlayToggleAutoplay.setAttribute('aria-pressed', isPlaying ? 'true' : 'false')
          photoOverlayToggleAutoplay.setAttribute(
            'aria-label',
            isPlaying
              ? (photoOverlayToggleAutoplay.dataset.pauseLabel || 'Pause slideshow')
              : (photoOverlayToggleAutoplay.dataset.startLabel || 'Start slideshow')
          )
        }

        const cancelAutoplayAnimation = () => {
          if (autoplayAnimationFrameId) {
            window.cancelAnimationFrame(autoplayAnimationFrameId)
            autoplayAnimationFrameId = null
          }
        }

        const updateAutoplayProgressFrame = () => {
          if (!photoOverlay || photoOverlay.hidden || !autoplayStartedAt) return

          const elapsed = Date.now() - autoplayStartedAt
          setAutoplayProgress(elapsed / autoplayDuration)

          if (elapsed < autoplayDuration) {
            autoplayAnimationFrameId = window.requestAnimationFrame(updateAutoplayProgressFrame)
          }
        }

        const stopAutoplay = ({ resetProgress = true } = {}) => {
          if (autoplayTimerId) {
            window.clearTimeout(autoplayTimerId)
            autoplayTimerId = null
          }

          cancelAutoplayAnimation()
          autoplayStartedAt = 0
          syncAutoplayButtonState(false)

          if (resetProgress) {
            setAutoplayProgress(0)
          }
        }

        const scheduleAutoplayTick = () => {
          if (photoOverlay?.hidden) return

          if (autoplayTimerId) {
            window.clearTimeout(autoplayTimerId)
          }

          cancelAutoplayAnimation()
          autoplayStartedAt = Date.now()
          setAutoplayProgress(0)
          syncAutoplayButtonState(true)
          autoplayAnimationFrameId = window.requestAnimationFrame(updateAutoplayProgressFrame)
          autoplayTimerId = window.setTimeout(() => {
            goToNextPhoto({ wrap: true, resetAutoplay: false })
            scheduleAutoplayTick()
          }, autoplayDuration)
        }

        const startAutoplay = () => {
          if (!photoOverlay || photoOverlay.hidden || activePhotoLinks.length < 2) return
          scheduleAutoplayTick()
        }

        const toggleAutoplay = () => {
          if (!photoOverlayToggleAutoplay) return

          if (photoOverlayToggleAutoplay.classList.contains('is-playing')) {
            stopAutoplay()
          } else {
            startAutoplay()
          }
        }

        const syncFullscreenButtonState = () => {
          if (!photoOverlayToggleFullscreen) return

          const isFullscreen = document.fullscreenElement === photoOverlay
          photoOverlayToggleFullscreen.classList.toggle('is-active', isFullscreen)
          photoOverlayToggleFullscreen.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false')
          photoOverlayToggleFullscreen.setAttribute(
            'aria-label',
            isFullscreen
              ? (photoOverlayToggleFullscreen.dataset.exitLabel || 'Exit fullscreen')
              : (photoOverlayToggleFullscreen.dataset.enterLabel || 'Enter fullscreen')
          )
        }

        const toggleOverlayFullscreen = async () => {
          if (!photoOverlay || !fullscreenApiSupported) return

          try {
            if (document.fullscreenElement === photoOverlay) {
              await document.exitFullscreen()
            } else {
              await photoOverlay.requestFullscreen()
            }
          } catch (error) {
            console.warn('Failed to toggle fullscreen mode.', error)
          }
        }

        const mountOverlayExif = () => {
          if (!photoOverlayExif) return
          // Keep the absolute-positioned inspector mounted so opacity/transform
          // can interpolate without reintroducing it into the image layout.
          photoOverlayExif.hidden = false
        }

        const photoIdFromHash = () => {
          const raw = window.location.hash.replace(/^#/, '')
          if (!raw) return ''
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        }

        const photoThumbnailSrc = (link, image = link?.querySelector?.('img')) =>
          link?.dataset?.photoThumbnailSrc || image?.currentSrc || image?.src || ''

        const photoOriginalSrc = (link, image = link?.querySelector?.('img')) =>
          link?.dataset?.photoViewerSrc
          || link?.dataset?.photoOriginalSrc
          || image?.currentSrc
          || image?.src
          || ''

        const linkForPhotoId = (photoId) => {
          if (!photoId) return null
          const figure = document.getElementById(photoId)
          return figure?.querySelector(':scope > a.image-link') || figure?.querySelector('.image-link') || null
        }

        const syncPhotoHash = (link) => {
          const photoId = link?.closest('figure')?.id
          if (!photoId || photoIdFromHash() === photoId) return
          history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${photoId}`)
        }

        const clearPhotoHash = () => {
          if (!photoIdFromHash()) return
          history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        }

        const parsePhotoMeta = (link) => {
          const photoMetaJson = link?.dataset?.photoMeta
          if (!photoMetaJson) return null

          try {
            return JSON.parse(photoMetaJson)
          } catch (error) {
            console.warn('Failed to parse photo metadata.', error)
            return null
          }
        }

        const renderOverlayCaption = (link) => {
          if (!photoOverlayCaption || !photoOverlayCaptionContent) return

          const captionMarkup = link
            ?.closest('figure')
            ?.querySelector('.caption-content')
            ?.innerHTML
            ?.trim()

          if (!captionMarkup) {
            photoOverlayCaption.hidden = true
            photoOverlayCaptionContent.innerHTML = ''
            return
          }

          photoOverlayCaptionContent.innerHTML = captionMarkup
          photoOverlayCaption.hidden = false
        }

        const detectHdrDisplaySupport = () => {
          const supportsWideGamut = (() => {
            try {
              return window.matchMedia('(color-gamut: p3)').matches || window.matchMedia('(color-gamut: rec2020)').matches
            } catch (error) {
              return false
            }
          })()

          const supportsHdrDynamicRange = (() => {
            try {
              return window.matchMedia('(dynamic-range: high)').matches || window.matchMedia('(video-dynamic-range: high)').matches
            } catch (error) {
              return false
            }
          })()

          return {
            supportsWideGamut,
            supportsHdrDynamicRange
          }
        }

        const formatHdrDisplayState = (photoMeta) => {
          if (!photoMeta?.hdrCandidate) return ''

          const capability = detectHdrDisplaySupport()

          if (capability.supportsHdrDynamicRange) {
            return 'HDR-capable display detected'
          }

          if (capability.supportsWideGamut) {
            return 'Wide-gamut display detected, HDR not confirmed'
          }

          return 'Standard display detected'
        }

        const formatHdrFallbackState = (photoMeta) => {
          if (!photoMeta) return ''

          if (photoMeta.fallbackGenerated) {
            return 'SDR fallback available'
          }

          if (photoMeta.assetPolicy === 'preserve-original' && photoMeta.fallbackStrategy === 'none') {
            return photoMeta.hdrCandidate
              ? 'Original asset preserved, browser-managed rendering'
              : 'Original asset preserved'
          }

          return ''
        }

        const renderOverlayExif = (link) => {
          if (!photoOverlayExif || !photoOverlayToggleExif) return

          const photoMeta = parsePhotoMeta(link)
          const exif = photoMeta?.exif || null
          const settings = [exif?.focalLength, exif?.aperture, exif?.shutter, exif?.iso].filter(Boolean).join('   ')
          const sourceFormat = photoMeta?.sourceFormat ? `${photoMeta.sourceFormat}`.toUpperCase() : ''
          const dynamicRange = photoMeta?.dynamicRange === 'hdr-candidate'
            ? 'HDR candidate'
            : (photoMeta?.dynamicRange === 'sdr' ? 'SDR' : '')
          const displayState = formatHdrDisplayState(photoMeta)
          const fallbackState = formatHdrFallbackState(photoMeta)
          const shouldShowFormat = Boolean(sourceFormat && sourceFormat !== 'JPG')
          const shouldShowRange = Boolean(dynamicRange)
          const shouldShowDisplay = Boolean(displayState)
          const shouldShowFallback = Boolean(fallbackState && (photoMeta?.hdrCandidate || photoMeta?.fallbackGenerated))
          const hasExif = Boolean(
            (exif && (exif.camera || exif.lens || settings || exif.capturedAt))
            || shouldShowFormat
            || shouldShowRange
            || shouldShowDisplay
            || shouldShowFallback
          )

          photoOverlayToggleExif.hidden = !hasExif

          const setRow = (key, text, visible) => {
            if (photoOverlayExifValues[key]) photoOverlayExifValues[key].textContent = text || ''
            if (photoOverlayExifRows[key]) photoOverlayExifRows[key].hidden = !visible
          }

          if (!hasExif) {
            photoOverlay.classList.remove('is-exif-open')
            photoOverlayToggleExif.setAttribute('aria-pressed', 'false')
            mountOverlayExif()
            ;['camera', 'lens', 'settings', 'capturedAt', 'format', 'range', 'display', 'fallback'].forEach((key) => {
              setRow(key, '', false)
            })
            return
          }

          setRow('camera', exif?.camera, Boolean(exif?.camera))
          setRow('lens', exif?.lens, Boolean(exif?.lens))
          setRow('settings', settings, Boolean(settings))
          setRow('capturedAt', exif?.capturedAt, Boolean(exif?.capturedAt))
          setRow('format', sourceFormat, shouldShowFormat)
          setRow('range', dynamicRange, shouldShowRange)
          setRow('display', displayState, shouldShowDisplay)
          setRow('fallback', fallbackState, shouldShowFallback)

          const isExifOpen = photoOverlay.classList.contains('is-exif-open')
          mountOverlayExif()
        }

        const updateOverlay = (photoIndex, { resetAutoplay = true } = {}) => {
          const link = activePhotoLinks[photoIndex]
          if (!link || !photoOverlayImage || !photoOverlayPosition) return

          const image = link.querySelector('img')
          const fullSource = photoOriginalSrc(link, image)
          const placeholderSource = photoThumbnailSrc(link, image)

          setOverlayImage(fullSource, image?.alt || 'Photo', { placeholderSource })
          photoOverlayPosition.textContent = `${photoIndex + 1} / ${activePhotoLinks.length}`
          currentPhotoIndex = photoIndex
          updateThumbnailActiveState(photoIndex)
          renderOverlayCaption(link)
          renderOverlayExif(link)
          syncPhotoHash(link)

          if (resetAutoplay && photoOverlayToggleAutoplay?.classList.contains('is-playing')) {
            scheduleAutoplayTick()
          }
        }

        const openOverlay = (photoIndex, links = activePhotoLinks) => {
          if (!photoOverlay) return
          if (overlayVisibilityTimerId) {
            window.clearTimeout(overlayVisibilityTimerId)
            overlayVisibilityTimerId = null
          }

          activePhotoLinks = links?.length ? links : allPhotoLinks
          overlayTrigger = activePhotoLinks[photoIndex] || null
          const albumKey = activePhotoLinks[0]?.closest?.('.photo-album')?.dataset?.album || 'all'
          if (albumKey !== thumbsAlbumKey) {
            thumbsAlbumKey = albumKey
            buildOverlayThumbnails()
          }

          if (photoOverlayToggleAutoplay) {
            photoOverlayToggleAutoplay.hidden = activePhotoLinks.length < 2
          }

          photoOverlay.classList.remove('is-closing')
          photoOverlay.classList.remove('is-exif-open')
          photoOverlayToggleExif?.setAttribute('aria-pressed', 'false')
          mountOverlayExif()
          // Mobile / narrow / short viewports: collapse thumbs so main image stays primary.
          // Keep 820px to match CSS overlay breakpoint; short height mirrors plan max-height ~540.
          setOverlayThumbnailsCollapsed(shouldDefaultCollapseThumbs())
          updateOverlay(photoIndex)
          lockPageScroll('overlay')
          document.body.classList.add('photo-overlay-open')
          document.documentElement.classList.add('photo-overlay-open')
          photoOverlay.hidden = false
          photoOverlay.setAttribute('aria-hidden', 'false')
          window.requestAnimationFrame(() => {
            photoOverlay.classList.add('is-visible')
            photoOverlayClose?.focus({ preventScroll: true })
          })
          syncFullscreenButtonState()
        }

        const closeOverlay = async () => {
          if (!photoOverlay || photoOverlay.hidden) return
          stopAutoplay()
          clearPhotoHash()

          if (document.fullscreenElement === photoOverlay) {
            try {
              await document.exitFullscreen()
            } catch (error) {
              console.warn('Failed to exit fullscreen mode.', error)
            }
          }

          photoOverlay.classList.remove('is-visible')
          photoOverlay.classList.add('is-closing')
          photoOverlay.setAttribute('aria-hidden', 'true')

          if (overlayVisibilityTimerId) {
            window.clearTimeout(overlayVisibilityTimerId)
          }

          overlayVisibilityTimerId = window.setTimeout(() => {
            photoOverlay.hidden = true
            photoOverlay.classList.remove('is-closing')
            document.body.classList.remove('photo-overlay-open')
            document.documentElement.classList.remove('photo-overlay-open')
            unlockPageScroll('overlay')
            overlayTrigger?.focus({ preventScroll: true })
            overlayTrigger = null
          }, 140)
        }

        const goToPreviousPhoto = ({ wrap = false, resetAutoplay = true } = {}) => {
          if (currentPhotoIndex > 0) {
            updateOverlay(currentPhotoIndex - 1, { resetAutoplay })
            return
          }

          if (wrap && activePhotoLinks.length > 1) {
            updateOverlay(activePhotoLinks.length - 1, { resetAutoplay })
          }
        }

        const goToNextPhoto = ({ wrap = false, resetAutoplay = true } = {}) => {
          if (currentPhotoIndex < activePhotoLinks.length - 1) {
            updateOverlay(currentPhotoIndex + 1, { resetAutoplay })
            return
          }

          if (wrap && activePhotoLinks.length > 1) {
            updateOverlay(0, { resetAutoplay })
          }
        }

        const toggleOverlayThumbnails = () => {
          if (!photoOverlay || !photoOverlayToggleThumbs) return
          const willCollapse = !photoOverlay.classList.contains('is-thumbs-collapsed')
          photoOverlay.classList.toggle('is-thumbs-collapsed', willCollapse)
          photoOverlayToggleThumbs.setAttribute('aria-pressed', willCollapse ? 'true' : 'false')
        }

        // Align with CSS `@media (max-width: 820px)` overlay layout (wider than plan's 768 mobile).
        const isCompactOverlayViewport = () => window.matchMedia('(max-width: 820px)').matches
        const isShortOverlayViewport = () => window.matchMedia('(max-height: 540px)').matches
        const shouldDefaultCollapseThumbs = () =>
          isCompactOverlayViewport() || isShortOverlayViewport()

        const setOverlayThumbnailsCollapsed = (collapsed) => {
          if (!photoOverlay || !photoOverlayToggleThumbs) return
          photoOverlay.classList.toggle('is-thumbs-collapsed', collapsed)
          photoOverlayToggleThumbs.setAttribute('aria-pressed', collapsed ? 'true' : 'false')
        }

        const toggleOverlayExif = () => {
          if (!photoOverlay || !photoOverlayToggleExif || photoOverlayToggleExif.hidden) return
          const willOpen = !photoOverlay.classList.contains('is-exif-open')
          mountOverlayExif()
          photoOverlay.classList.toggle('is-exif-open', willOpen)
          photoOverlayToggleExif.setAttribute('aria-pressed', willOpen ? 'true' : 'false')
        }

        const TAP_MOVE_THRESHOLD = 10
        let touchedPhotoLink = null
        let linkTouchStartX = 0
        let linkTouchStartY = 0
        const suppressClickUntil = new WeakMap()

        const photoLinkFromEvent = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return null
          const link = target.closest('#photos .image-link')
          return link && photos?.contains(link) ? link : null
        }

        const openFromPhotoLink = (link, event) => {
          event.preventDefault()
          event.stopPropagation()
          const links = albumLinksFor(link)
          const index = Math.max(0, links.indexOf(link))
          openOverlay(index, links)
        }

        photos?.addEventListener('touchstart', (event) => {
          const link = photoLinkFromEvent(event)
          const touch = event.changedTouches?.[0] || event.touches?.[0]
          if (!link || !touch) return
          touchedPhotoLink = link
          linkTouchStartX = touch.clientX
          linkTouchStartY = touch.clientY
        }, { passive: true })

        photos?.addEventListener('touchend', (event) => {
          const link = photoLinkFromEvent(event)
          const touch = event.changedTouches?.[0]
          if (!link || link !== touchedPhotoLink || !touch) {
            touchedPhotoLink = null
            return
          }

          const dx = touch.clientX - linkTouchStartX
          const dy = touch.clientY - linkTouchStartY
          const moved = Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD
          suppressClickUntil.set(link, Date.now() + 500)
          touchedPhotoLink = null
          if (!moved) openFromPhotoLink(link, event)
        }, { passive: false })

        photos?.addEventListener('click', (event) => {
          const link = photoLinkFromEvent(event)
          if (!link) return
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            return
          }
          if ((suppressClickUntil.get(link) || 0) > Date.now()) {
            event.preventDefault()
            return
          }
          openFromPhotoLink(link, event)
        })

        const openFromHash = () => {
          const link = linkForPhotoId(photoIdFromHash())
          if (!link) return false
          const links = albumLinksFor(link)
          const index = Math.max(0, links.indexOf(link))
          if (!photoOverlay?.hidden && currentPhotoIndex === index && activePhotoLinks[index] === link) {
            return true
          }
          openOverlay(index, links)
          return true
        }

        const redirectIndexHash = () => {
          if (photos?.dataset.photosView !== 'index') return Promise.resolve(false)
          const photoId = photoIdFromHash()
          if (!photoId) return Promise.resolve(false)
          return ensureRemoteSearchIndex().then(() => {
            const item = searchIndex.find((entry) => entry.id === photoId)
            if (!item?.slug) return false
            window.location.replace(`/photos/${item.slug}/#${photoId}`)
            return true
          })
        }

        window.addEventListener('hashchange', () => {
          if (!photoIdFromHash()) {
            if (photoOverlay && !photoOverlay.hidden) closeOverlay()
            return
          }
          redirectIndexHash().then((redirected) => {
            if (!redirected) openFromHash()
          })
        })

        redirectIndexHash().then((redirected) => {
          if (!redirected) openFromHash()
        })

        if (!fullscreenApiSupported && photoOverlayToggleFullscreen) {
          photoOverlayToggleFullscreen.hidden = true
        }

        photoOverlayClose?.addEventListener('click', closeOverlay)
        photoOverlayToggleExif?.addEventListener('click', toggleOverlayExif)
        photoOverlayToggleThumbs?.addEventListener('click', toggleOverlayThumbnails)
        photoOverlayToggleFullscreen?.addEventListener('click', toggleOverlayFullscreen)
        photoOverlayToggleAutoplay?.addEventListener('click', toggleAutoplay)
        document.addEventListener('fullscreenchange', syncFullscreenButtonState)

        photoOverlay?.addEventListener('click', (event) => {
          if (event.target === photoOverlay || event.target === photoOverlayStage || event.target === photoOverlayBody) {
            closeOverlay()
          }
        })

        photoOverlayStage?.addEventListener('wheel', (event) => {
          if (!photoOverlay || photoOverlay.hidden) return
          event.preventDefault()

          const now = Date.now()
          if (now < wheelSwitchLockedUntil) return
          if (Math.abs(event.deltaY) < 8) return

          wheelSwitchLockedUntil = now + 220
          if (event.deltaY > 0) {
            goToNextPhoto()
          } else {
            goToPreviousPhoto()
          }
        }, { passive: false })

        photoOverlayStage?.addEventListener('touchstart', (event) => {
          touchStartX = event.changedTouches[0].clientX
        }, { passive: true })

        photoOverlayStage?.addEventListener('touchend', (event) => {
          touchEndX = event.changedTouches[0].clientX
          const touchDistance = touchEndX - touchStartX
          const swipeThreshold = 40

          if (touchDistance > swipeThreshold) {
            goToPreviousPhoto()
          } else if (touchDistance < -swipeThreshold) {
            goToNextPhoto()
          }
        }, { passive: true })

        photoOverlayStage?.addEventListener('touchmove', (event) => {
          if (!photoOverlay || photoOverlay.hidden) return
          event.preventDefault()
        }, { passive: false })

        document.addEventListener('keydown', (event) => {
          if (!photoOverlay || photoOverlay.hidden) return

          if (event.key === 'Tab') {
            const focusable = Array.from(
              photoOverlay.querySelectorAll('button:not([hidden]):not([disabled])')
            ).filter((element) => element.getClientRects().length > 0)
            const first = focusable[0]
            const last = focusable[focusable.length - 1]

            if (!first || !last) {
              event.preventDefault()
              photoOverlay.focus({ preventScroll: true })
            } else if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last.focus({ preventScroll: true })
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first.focus({ preventScroll: true })
            }
          } else if (event.key === 'Escape') {
            closeOverlay()
          } else if (event.key === 'ArrowLeft') {
            goToPreviousPhoto()
          } else if (event.key === 'ArrowRight') {
            goToNextPhoto()
          } else if (event.key.toLowerCase() === 'f') {
            event.preventDefault()
            toggleOverlayFullscreen()
          } else if (event.key === ' ') {
            event.preventDefault()
            toggleAutoplay()
          }
        })
