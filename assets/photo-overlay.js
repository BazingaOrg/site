        const photos = document.querySelector('#photos')
        let layoutTransitionTimer = null
        const checkedLayoutInput = document.querySelector('input[name="layout"]:checked')
        const photoLinks = Array.from(document.querySelectorAll('#photos .image-link'))
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
        const photoOverlayExifCameraRow = document.querySelector('#photo-overlay-exif-camera-row')
        const photoOverlayExifLensRow = document.querySelector('#photo-overlay-exif-lens-row')
        const photoOverlayExifSettingsRow = document.querySelector('#photo-overlay-exif-settings-row')
        const photoOverlayExifCapturedAtRow = document.querySelector('#photo-overlay-exif-captured-at-row')
        const photoOverlayExifFormatRow = document.querySelector('#photo-overlay-exif-format-row')
        const photoOverlayExifRangeRow = document.querySelector('#photo-overlay-exif-range-row')
        const photoOverlayExifDisplayRow = document.querySelector('#photo-overlay-exif-display-row')
        const photoOverlayExifFallbackRow = document.querySelector('#photo-overlay-exif-fallback-row')
        const photoOverlayExifCamera = document.querySelector('#photo-overlay-exif-camera')
        const photoOverlayExifLens = document.querySelector('#photo-overlay-exif-lens')
        const photoOverlayExifSettings = document.querySelector('#photo-overlay-exif-settings')
        const photoOverlayExifCapturedAt = document.querySelector('#photo-overlay-exif-captured-at')
        const photoOverlayExifFormat = document.querySelector('#photo-overlay-exif-format')
        const photoOverlayExifRange = document.querySelector('#photo-overlay-exif-range')
        const photoOverlayExifDisplay = document.querySelector('#photo-overlay-exif-display')
        const photoOverlayExifFallback = document.querySelector('#photo-overlay-exif-fallback')
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

        const fullscreenApiSupported = Boolean(
          document.fullscreenEnabled
          && photoOverlay?.requestFullscreen
          && document.exitFullscreen
        )

        if (photos && checkedLayoutInput) {
          photos.dataset.layout = checkedLayoutInput.value
        }

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

        // Track layout switch and animate visual transition
        document.addEventListener('change', function(event) {
          const target = event.target

          if (target && target.matches('input[name="layout"]')) {
            if (photos) {
              photos.dataset.layout = target.value
              photos.classList.add('is-layout-switching')
              if (layoutTransitionTimer) {
                clearTimeout(layoutTransitionTimer)
              }
              layoutTransitionTimer = window.setTimeout(() => {
                photos.classList.remove('is-layout-switching')
              }, 220)
            }

            try {
              if (typeof window.umami === 'function') {
                window.umami('photos_layout_change', {
                  layout: target.value,
                  control_id: target.id,
                  current_page: window.location.pathname,
                  language: document.documentElement.lang || 'en-US'
                })
              } else if (window.umami?.track) {
                window.umami.track('photos_layout_change', {
                  layout: target.value,
                  control_id: target.id,
                  current_page: window.location.pathname,
                  language: document.documentElement.lang || 'en-US'
                })
              }
            } catch (error) {
              console.log('Umami tracking error:', error)
            }
          }

        })

        const buildOverlayThumbnails = () => {
          if (!photoOverlayThumbs) return

          const fragment = document.createDocumentFragment()
          photoLinks.forEach((link, index) => {
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
          if (!photoOverlay || photoOverlay.hidden || photoLinks.length < 2) return
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

          if (!hasExif) {
            photoOverlay.classList.remove('is-exif-open')
            photoOverlayToggleExif.setAttribute('aria-pressed', 'false')
            setOverlayExifVisibility(false)
            photoOverlayExifCamera.textContent = ''
            photoOverlayExifLens.textContent = ''
            photoOverlayExifSettings.textContent = ''
            photoOverlayExifCapturedAt.textContent = ''
            photoOverlayExifFormat.textContent = ''
            photoOverlayExifRange.textContent = ''
            photoOverlayExifDisplay.textContent = ''
            photoOverlayExifFallback.textContent = ''
            photoOverlayExifCameraRow.hidden = true
            photoOverlayExifLensRow.hidden = true
            photoOverlayExifSettingsRow.hidden = true
            photoOverlayExifCapturedAtRow.hidden = true
            photoOverlayExifFormatRow.hidden = true
            photoOverlayExifRangeRow.hidden = true
            photoOverlayExifDisplayRow.hidden = true
            photoOverlayExifFallbackRow.hidden = true
            return
          }

          photoOverlayExifCamera.textContent = exif?.camera || ''
          photoOverlayExifLens.textContent = exif?.lens || ''
          photoOverlayExifSettings.textContent = settings
          photoOverlayExifCapturedAt.textContent = exif?.capturedAt || ''
          photoOverlayExifFormat.textContent = sourceFormat
          photoOverlayExifRange.textContent = dynamicRange
          photoOverlayExifDisplay.textContent = displayState
          photoOverlayExifFallback.textContent = fallbackState
          photoOverlayExifCameraRow.hidden = !exif?.camera
          photoOverlayExifLensRow.hidden = !exif?.lens
          photoOverlayExifSettingsRow.hidden = !settings
          photoOverlayExifCapturedAtRow.hidden = !exif?.capturedAt
          photoOverlayExifFormatRow.hidden = !shouldShowFormat
          photoOverlayExifRangeRow.hidden = !shouldShowRange
          photoOverlayExifDisplayRow.hidden = !shouldShowDisplay
          photoOverlayExifFallbackRow.hidden = !shouldShowFallback

          const isExifOpen = photoOverlay.classList.contains('is-exif-open')
          setOverlayExifVisibility(isExifOpen)
        }

        const updateOverlay = (photoIndex, { resetAutoplay = true } = {}) => {
          const link = photoLinks[photoIndex]
          if (!link || !photoOverlayImage || !photoOverlayPosition) return

          const image = link.querySelector('img')
          const fullSource = link.href || link.dataset.photoOriginalSrc || image?.currentSrc || image?.src
          const placeholderSource =
            link.dataset.photoPreviewSrc
            || link.dataset.photoThumbnailSrc
            || image?.currentSrc
            || image?.src

          setOverlayImage(fullSource, image?.alt || 'Photo', { placeholderSource })
          photoOverlayPosition.textContent = `${photoIndex + 1} / ${photoLinks.length}`
          currentPhotoIndex = photoIndex
          updateThumbnailActiveState(photoIndex)
          renderOverlayCaption(link)
          renderOverlayExif(link)

          if (resetAutoplay && photoOverlayToggleAutoplay?.classList.contains('is-playing')) {
            scheduleAutoplayTick()
          }
        }

        const openOverlay = (photoIndex) => {
          if (!photoOverlay) return
          if (overlayVisibilityTimerId) {
            window.clearTimeout(overlayVisibilityTimerId)
            overlayVisibilityTimerId = null
          }
          photoOverlay.classList.remove('is-closing')
          photoOverlay.classList.remove('is-exif-open')
          photoOverlayToggleExif?.setAttribute('aria-pressed', 'false')
          setOverlayExifVisibility(false)
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

          if (wrap && photoLinks.length > 1) {
            updateOverlay(photoLinks.length - 1, { resetAutoplay })
          }
        }

        const goToNextPhoto = ({ wrap = false, resetAutoplay = true } = {}) => {
          if (currentPhotoIndex < photoLinks.length - 1) {
            updateOverlay(currentPhotoIndex + 1, { resetAutoplay })
            return
          }

          if (wrap && photoLinks.length > 1) {
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

        const isCompactOverlayViewport = () => window.matchMedia('(max-width: 820px)').matches

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

          if (willOpen && isCompactOverlayViewport() && !photoOverlay.classList.contains('is-thumbs-collapsed')) {
            setOverlayThumbnailsCollapsed(true)
            autoCollapsedThumbsForExif = true
          } else if (!willOpen && autoCollapsedThumbsForExif) {
            setOverlayThumbnailsCollapsed(false)
            autoCollapsedThumbsForExif = false
          }
        }

        photoLinks.forEach((link, index) => {
          const openFromLinkEvent = (event) => {
            event.preventDefault()
            event.stopPropagation()
            openOverlay(index)
          }

          link.addEventListener('click', (event) => {
            if (justHandledTouch) {
              justHandledTouch = false
              event.preventDefault()
              return
            }
            openFromLinkEvent(event)
          })

          link.addEventListener('touchend', (event) => {
            justHandledTouch = true
            openFromLinkEvent(event)
          }, { passive: false })
        })

        buildOverlayThumbnails()

        if (!fullscreenApiSupported && photoOverlayToggleFullscreen) {
          photoOverlayToggleFullscreen.hidden = true
        }

        if (photoLinks.length < 2 && photoOverlayToggleAutoplay) {
          photoOverlayToggleAutoplay.hidden = true
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
