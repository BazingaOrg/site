// 照片页面交互追踪增强
// 与用户旅程分析集成的照片浏览行为追踪

document.addEventListener('DOMContentLoaded', () => {
  // 确保旅程追踪器已加载
  if (!window.journeyTracker) {
    console.warn('Journey tracker not available for photo interaction tracking')
    return
  }

  const photos = document.querySelectorAll('.image-link')
  const photosWrapper = document.getElementById('photos')

  if (photos.length === 0) return

  // 追踪照片查看转化目标
  photos.forEach((link, index) => {
    link.addEventListener('click', (e) => {
      const photoId = link.getAttribute('data-umami-event-photo-id')
      const ratio = link.getAttribute('data-umami-event-ratio')

      // 追踪照片查看转化目标
      window.journeyTracker.trackConversionGoal('photo_view', {
        photoId: photoId,
        photoIndex: index,
        photoRatio: ratio,
        totalPhotos: photos.length,
        viewLocation: 'photos_page'
      })
    })

    // 监听图片加载完成，追踪浏览深度
    const img = link.querySelector('img')
    if (img) {
      // 设置图片进入视口的观察器
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const photoId = link.getAttribute('data-umami-event-photo-id')

            // 追踪照片可见转化目标
            window.journeyTracker.trackConversionGoal('photo_visible', {
              photoId: photoId,
              photoIndex: index,
              viewDepth: Math.round((index + 1) / photos.length * 100),
              totalPhotos: photos.length
            })

            observer.unobserve(entry.target)
          }
        })
      }, {
        threshold: 0.7, // 70% 可见时触发
        rootMargin: '0px'
      })

      observer.observe(img)
    }
  })

  // 监听 Open Heart 点击转化
  document.addEventListener('open-heart:liked', (event) => {
    const heartElement = event.target
    const figure = heartElement.closest('figure')

    if (figure) {
      const photoId = figure.id.replace('P', '') // 去掉 P 前缀

      window.journeyTracker.trackConversionGoal('photo_like', {
        photoId: photoId,
        interactionType: 'like',
        contentType: 'photo'
      })
    }
  })

  // 追踪照片页面列数/密度变化（range: dataset.resolved = auto|3..8）
  const columnsSlider = document.querySelector('#photo-columns')
  if (columnsSlider) {
    columnsSlider.addEventListener('change', (e) => {
      const layout = e.target.dataset.resolved || e.target.value
      window.journeyTracker.trackConversionGoal('photo_layout_change', {
        newLayout: layout,
        layoutId: e.target.id || 'photo-columns',
        totalPhotos: photos.length
      })
    })
  }

  // 追踪深度浏览行为
  let maxScrollPhotos = 0
  const trackScrollDepth = () => {
    const visiblePhotos = Array.from(photos).filter(photo => {
      const rect = photo.getBoundingClientRect()
      return rect.top < window.innerHeight && rect.bottom > 0
    }).length

    if (visiblePhotos > maxScrollPhotos) {
      maxScrollPhotos = visiblePhotos

      // 当用户浏览超过50%的照片时触发深度参与转化
      const browsePercentage = (maxScrollPhotos / photos.length) * 100
      if (browsePercentage >= 50) {
        window.journeyTracker.trackConversionGoal('photo_deep_browse', {
          photosViewed: maxScrollPhotos,
          totalPhotos: photos.length,
          browsePercentage: Math.round(browsePercentage),
          engagementLevel: 'deep'
        })
      }
    }
  }

  // 防抖处理滚动事件
  let scrollTimer = null
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer)
    scrollTimer = setTimeout(trackScrollDepth, 200)
  })

  // 初始检查
  trackScrollDepth()
})