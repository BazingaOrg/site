        const photos = document.querySelector('#photos')
        const photosChrome = document.querySelector('#photos-chrome')
        // Site chrome on photos page (back/logo) — sticky like afilmory top bar.
        const photosSiteHeader = document.querySelector('body[data-page-type="photos"] > header')
        let layoutTransitionTimer = null
        // Range: 0 = Auto, 1..6 → columns 3..8
        const columnsSlider = document.querySelector('#photo-columns')
        const columnsValueEl = document.querySelector('#photo-columns-value')
        const COLUMNS_STORAGE_KEY = 'photos-columns'

        // Stack heights: site header → tools chrome → album title stickies.
        const syncPhotosStickyOffsets = () => {
          const headerH = photosSiteHeader
            ? Math.ceil(photosSiteHeader.getBoundingClientRect().height)
            : 0
          const chromeH = photosChrome
            ? Math.ceil(photosChrome.getBoundingClientRect().height)
            : 0
          const root = document.documentElement
          root.style.setProperty('--photos-site-header-height', `${headerH}px`)
          root.style.setProperty('--photos-chrome-height', `${chromeH}px`)
        }
        syncPhotosStickyOffsets()
        if (typeof ResizeObserver !== 'undefined') {
          const stickyRo = new ResizeObserver(() => {
            syncPhotosStickyOffsets()
          })
          if (photosSiteHeader) stickyRo.observe(photosSiteHeader)
          if (photosChrome) stickyRo.observe(photosChrome)
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
        let justHandledTouch = false
        let autoCollapsedThumbsForExif = false
        let overlayImageRequestToken = 0
        let autoplayTimerId = null
        let autoplayAnimationFrameId = null
        let autoplayStartedAt = 0
        let autoplayDuration = 4800
        let overlayVisibilityTimerId = null
        let exifVisibilityTimerId = null
        let thumbsAlbumKey = null
        let searchDebounceTimer = null

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

        const applyPhotoColumns = (value, { animate = true } = {}) => {
          if (!photos) return
          const next = ALLOWED_COLUMNS.has(value) ? value : 'auto'
          photos.dataset.columns = next
          syncColumnsSliderUi(next)
          if (!animate) return
          photos.classList.add('is-layout-switching')
          if (layoutTransitionTimer) {
            clearTimeout(layoutTransitionTimer)
          }
          layoutTransitionTimer = window.setTimeout(() => {
            photos.classList.remove('is-layout-switching')
          }, 220)
        }

        let storedColumns = null
        try {
          storedColumns = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
        } catch {
          storedColumns = null
        }
        // Migrate legacy select values; default Auto
        applyPhotoColumns(storedColumns || 'auto', { animate: false })

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

        // Compact album/filename jump search (max 10 results)
        const searchRoot = document.querySelector('.photo-search')
        const searchInput = document.querySelector('#photo-search-input')
        const searchClear = document.querySelector('.photo-search-clear')
        const searchResults = document.querySelector('#photo-search-results')
        const searchStatus = document.querySelector('#photo-search-status')
        // Afilmory-style row: thumb + title + subtitle (site tokens; no cmdk).
        const searchIndex = Array.from(document.querySelectorAll('#photos figure[data-photo-search]')).map((figure) => {
          const title = figure.dataset.photoTitle || figure.dataset.photoLabel || figure.id
          const subtitle = figure.dataset.photoSubtitle || ''
          const thumb =
            figure.dataset.photoThumb
            || figure.querySelector('img')?.currentSrc
            || figure.querySelector('img')?.src
            || ''
          return {
            id: figure.id,
            text: (figure.dataset.photoSearch || '').toLowerCase(),
            title,
            subtitle,
            thumb,
            label: figure.dataset.photoLabel || [title, subtitle].filter(Boolean).join(' · ')
          }
        })

        const clearPhotoSearch = () => {
          if (searchInput) searchInput.value = ''
          if (searchResults) {
            searchResults.hidden = true
            searchResults.innerHTML = ''
          }
          if (searchStatus) searchStatus.textContent = ''
          if (searchClear) searchClear.hidden = true
        }

        const jumpToPhotoResult = (photoId) => {
          const target = document.getElementById(photoId)
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' })
            if (typeof target.focus === 'function') {
              try {
                target.setAttribute('tabindex', '-1')
                target.focus({ preventScroll: true })
              } catch {
                // ignore focus errors
              }
            }
          }
          if (searchResults) searchResults.hidden = true
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
            li.setAttribute('role', 'option')

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
          searchStatus.textContent = capped ? '10+' : String(matches.length)
        }

        searchInput?.addEventListener('input', () => {
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
          searchDebounceTimer = window.setTimeout(() => {
            runPhotoSearch(searchInput.value)
          }, 150)
        })

        searchInput?.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            clearPhotoSearch()
            searchInput.blur()
          }
        })

        searchClear?.addEventListener('click', () => {
          clearPhotoSearch()
          searchInput?.focus()
        })

        document.addEventListener('click', (event) => {
          if (!searchRoot || !searchResults || searchResults.hidden) return
          if (searchRoot.contains(event.target)) return
          searchResults.hidden = true
        })

        const buildOverlayThumbnails = () => {
          if (!photoOverlayThumbs) return

          const fragment = document.createDocumentFragment()
          activePhotoLinks.forEach((link, index) => {
            const sourceImage = link.querySelector('img')
            const thumbnailButton = document.createElement('button')
            thumbnailButton.type = 'button'
            thumbnailButton.className = 'photo-overlay-thumb'
            thumbnailButton.setAttribute('aria-label', `View photo ${index + 1}`)
            thumbnailButton.dataset.photoIndex = `${index}`

            const thumbnailImage = document.createElement('img')
            thumbnailImage.src = link.dataset.photoThumbnailSrc || sourceImage?.currentSrc || sourceImage?.src || link.href
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
          photoOverlayImage.classList.remove('is-entering')
          // restart animation for each photo switch
          void photoOverlayImage.offsetWidth
          photoOverlayImage.alt = altText || ''

          const markReady = () => {
            if (requestToken !== overlayImageRequestToken) return
            setOverlayLoadingState(false)
            photoOverlayImage.classList.add('is-entering')
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
              photoOverlayImage.classList.add('is-entering')
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
          photoOverlayToggleAutoplay.setAttribute('aria-label', isPlaying ? 'Pause slideshow' : 'Start slideshow')
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
          photoOverlayToggleFullscreen.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen')
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

        const setOverlayExifVisibility = (isVisible) => {
          if (!photoOverlayExif) return

          if (exifVisibilityTimerId) {
            window.clearTimeout(exifVisibilityTimerId)
            exifVisibilityTimerId = null
          }

          if (isVisible) {
            photoOverlayExif.hidden = false
            return
          }

          exifVisibilityTimerId = window.setTimeout(() => {
            if (!photoOverlay?.classList.contains('is-exif-open')) {
              photoOverlayExif.hidden = true
            }
          }, 180)
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
            setOverlayExifVisibility(false)
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
          setOverlayExifVisibility(isExifOpen)
        }

        const updateOverlay = (photoIndex, { resetAutoplay = true } = {}) => {
          const link = activePhotoLinks[photoIndex]
          if (!link || !photoOverlayImage || !photoOverlayPosition) return

          const image = link.querySelector('img')
          const fullSource = link.href || link.dataset.photoOriginalSrc || image?.currentSrc || image?.src
          const placeholderSource =
            link.dataset.photoThumbnailSrc
            || image?.currentSrc
            || image?.src

          setOverlayImage(fullSource, image?.alt || 'Photo', { placeholderSource })
          photoOverlayPosition.textContent = `${photoIndex + 1} / ${activePhotoLinks.length}`
          currentPhotoIndex = photoIndex
          updateThumbnailActiveState(photoIndex)
          renderOverlayCaption(link)
          renderOverlayExif(link)

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
          setOverlayExifVisibility(false)
          // Mobile / narrow / short viewports: collapse thumbs so main image stays primary.
          // Keep 820px to match CSS overlay breakpoint; short height mirrors plan max-height ~540.
          setOverlayThumbnailsCollapsed(shouldDefaultCollapseThumbs())
          autoCollapsedThumbsForExif = false
          updateOverlay(photoIndex)
          const scrollbarCompensation = window.innerWidth - document.documentElement.clientWidth
          document.body.style.setProperty('--overlay-scrollbar-compensation', `${Math.max(0, scrollbarCompensation)}px`)
          document.body.classList.add('photo-overlay-open')
          document.documentElement.classList.add('photo-overlay-open')
          photoOverlay.hidden = false
          photoOverlay.setAttribute('aria-hidden', 'false')
          window.requestAnimationFrame(() => {
            photoOverlay.classList.add('is-visible')
          })
          syncFullscreenButtonState()
        }

        const closeOverlay = async () => {
          if (!photoOverlay || photoOverlay.hidden) return
          stopAutoplay()

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
            document.body.style.removeProperty('--overlay-scrollbar-compensation')
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
          autoCollapsedThumbsForExif = false
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
          setOverlayExifVisibility(willOpen)
          photoOverlay.classList.toggle('is-exif-open', willOpen)
          photoOverlayToggleExif.setAttribute('aria-pressed', willOpen ? 'true' : 'false')

          if (willOpen && shouldDefaultCollapseThumbs() && !photoOverlay.classList.contains('is-thumbs-collapsed')) {
            setOverlayThumbnailsCollapsed(true)
            autoCollapsedThumbsForExif = true
          } else if (!willOpen && autoCollapsedThumbsForExif) {
            setOverlayThumbnailsCollapsed(false)
            autoCollapsedThumbsForExif = false
          }
        }

        const TAP_MOVE_THRESHOLD = 10

        allPhotoLinks.forEach((link) => {
          const openFromLinkEvent = (event) => {
            event.preventDefault()
            event.stopPropagation()
            const links = albumLinksFor(link)
            const index = Math.max(0, links.indexOf(link))
            openOverlay(index, links)
          }

          let linkTouchStartX = 0
          let linkTouchStartY = 0

          link.addEventListener('touchstart', (event) => {
            const touch = event.changedTouches?.[0] || event.touches?.[0]
            if (!touch) return
            linkTouchStartX = touch.clientX
            linkTouchStartY = touch.clientY
          }, { passive: true })

          link.addEventListener('click', (event) => {
            if (justHandledTouch) {
              justHandledTouch = false
              event.preventDefault()
              return
            }
            openFromLinkEvent(event)
          })

          link.addEventListener('touchend', (event) => {
            const touch = event.changedTouches?.[0]
            if (!touch) return

            const dx = touch.clientX - linkTouchStartX
            const dy = touch.clientY - linkTouchStartY
            const moved = Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD

            if (moved) {
              // Ignore scroll gestures. Briefly swallow a possible synthetic click
              // without leaving justHandledTouch stuck (which would block the next real tap).
              justHandledTouch = true
              window.setTimeout(() => {
                justHandledTouch = false
              }, 400)
              return
            }

            justHandledTouch = true
            openFromLinkEvent(event)
          }, { passive: false })
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

          if (event.key === 'Escape') {
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
