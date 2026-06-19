// 性能指标追踪模块
// 追踪 Core Web Vitals 和其他关键性能指标

import { trackUmami } from './events.js'
import { createPrefixedId } from './id.js'

/**
 * 性能追踪器类
 */
class PerformanceTracker {
  constructor() {
    this.sessionId = this.generateSessionId()
    this.startTime = performance.now()
    this.metrics = {
      lcp: null,
      fid: null,
      cls: null,
      ttfb: null,
      fcp: null,
      inp: null
    }
    this.navigationTiming = null
    this.resourceTimings = []
    this.customTimings = {}
    this.errorCount = 0
    this.memoryInfo = null

    this.init()
  }

  generateSessionId() {
    return createPrefixedId('perf')
  }

  init() {
    this.collectNavigationTiming()
    this.trackCoreWebVitals()
    this.trackResourcePerformance()
    this.trackNetworkQuality()
    this.trackDeviceInfo()
    this.trackMemoryUsage()
    this.trackScriptErrors()
    this.trackCustomTimings()
    this.setupVisibilityTracking()

    // 页面卸载时发送性能汇总
    window.addEventListener('beforeunload', () => {
      this.sendPerformanceSummary()
    })

    // 页面隐藏时也发送（移动端）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sendPerformanceSummary()
      }
    })
  }

  /**
   * Core Web Vitals 追踪
   */
  trackCoreWebVitals() {
    // 使用 web-vitals 库的方式（如果可用）
    if (typeof window.webVitals !== 'undefined') {
      this.trackWithWebVitalsLibrary()
      return
    }

    // 原生 API 方式
    this.trackCoreWebVitalsNative()
  }

  trackWithWebVitalsLibrary() {
    // 假设有 web-vitals 库可用
    if (window.webVitals) {
      window.webVitals.onCLS(this.onCLS.bind(this))
      window.webVitals.onFID(this.onFID.bind(this))
      window.webVitals.onLCP(this.onLCP.bind(this))
      window.webVitals.onFCP(this.onFCP.bind(this))
      window.webVitals.onTTFB(this.onTTFB.bind(this))
      if (window.webVitals.onINP) {
        window.webVitals.onINP(this.onINP.bind(this))
      }
    }
  }

  trackCoreWebVitalsNative() {
    // LCP - Largest Contentful Paint
    if ('PerformanceObserver' in window) {
      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries()
          const lastEntry = entries[entries.length - 1]
          this.onLCP({ value: lastEntry.startTime, entries })
        })
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
      } catch (e) {
        console.warn('LCP tracking not supported:', e)
      }

      // FID - First Input Delay
      try {
        const fidObserver = new PerformanceObserver((entryList) => {
          entryList.getEntries().forEach((entry) => {
            this.onFID({ value: entry.processingStart - entry.startTime, entries: [entry] })
          })
        })
        fidObserver.observe({ type: 'first-input', buffered: true })
      } catch (e) {
        console.warn('FID tracking not supported:', e)
      }

      // CLS - Cumulative Layout Shift
      try {
        let clsValue = 0
        let clsEntries = []
        const clsObserver = new PerformanceObserver((entryList) => {
          entryList.getEntries().forEach((entry) => {
            if (!entry.hadRecentInput) {
              clsValue += entry.value
              clsEntries.push(entry)
            }
          })
          this.onCLS({ value: clsValue, entries: clsEntries })
        })
        clsObserver.observe({ type: 'layout-shift', buffered: true })
      } catch (e) {
        console.warn('CLS tracking not supported:', e)
      }

      // FCP - First Contentful Paint
      try {
        const fcpObserver = new PerformanceObserver((entryList) => {
          entryList.getEntries().forEach((entry) => {
            if (entry.name === 'first-contentful-paint') {
              this.onFCP({ value: entry.startTime, entries: [entry] })
            }
          })
        })
        fcpObserver.observe({ type: 'paint', buffered: true })
      } catch (e) {
        console.warn('FCP tracking not supported:', e)
      }
    }

    // TTFB - Time to First Byte
    if (performance.timing) {
      const ttfb = performance.timing.responseStart - performance.timing.requestStart
      this.onTTFB({ value: ttfb })
    }
  }

  // Core Web Vitals 回调函数
  onLCP(metric) {
    this.metrics.lcp = metric.value
    this.trackMetric('lcp', metric)
  }

  onFID(metric) {
    this.metrics.fid = metric.value
    this.trackMetric('fid', metric)
  }

  onCLS(metric) {
    this.metrics.cls = metric.value
    this.trackMetric('cls', metric)
  }

  onFCP(metric) {
    this.metrics.fcp = metric.value
    this.trackMetric('fcp', metric)
  }

  onTTFB(metric) {
    this.metrics.ttfb = metric.value
    this.trackMetric('ttfb', metric)
  }

  onINP(metric) {
    this.metrics.inp = metric.value
    this.trackMetric('inp', metric)
  }

  trackMetric(name, metric) {
    const rating = this.getMetricRating(name, metric.value)

    trackUmami('core_web_vital', {
      metric_name: name.toLowerCase(),
      metric_value: Math.round(metric.value),
      rating: rating,
      session_id: this.sessionId,
      page_url: window.location.pathname,
      page_type: document.body.getAttribute('data-page-type') || 'page',
      language: document.documentElement.lang || 'en-US',
      timestamp: new Date().toISOString()
    })
  }

  getMetricRating(name, value) {
    const thresholds = {
      lcp: { good: 2500, poor: 4000 },
      fid: { good: 100, poor: 300 },
      cls: { good: 0.1, poor: 0.25 },
      fcp: { good: 1800, poor: 3000 },
      ttfb: { good: 800, poor: 1800 },
      inp: { good: 200, poor: 500 }
    }

    const threshold = thresholds[name]
    if (!threshold) return 'unknown'

    if (value <= threshold.good) return 'good'
    if (value <= threshold.poor) return 'needs-improvement'
    return 'poor'
  }

  /**
   * 收集导航时序信息
   */
  collectNavigationTiming() {
    if (!performance.timing) return

    const timing = performance.timing
    const navigationStart = timing.navigationStart

    this.navigationTiming = {
      dns: timing.domainLookupEnd - timing.domainLookupStart,
      tcp: timing.connectEnd - timing.connectStart,
      ssl: timing.secureConnectionStart > 0 ? timing.connectEnd - timing.secureConnectionStart : 0,
      ttfb: timing.responseStart - timing.requestStart,
      download: timing.responseEnd - timing.responseStart,
      domInteractive: timing.domInteractive - navigationStart,
      domContentLoaded: timing.domContentLoadedEventStart - navigationStart,
      domComplete: timing.domComplete - navigationStart,
      loadEvent: timing.loadEventEnd - navigationStart
    }

    trackUmami('navigation_timing', {
      ...this.navigationTiming,
      session_id: this.sessionId,
      page_url: window.location.pathname,
      page_type: document.body.getAttribute('data-page-type') || 'page',
      language: document.documentElement.lang || 'en-US',
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 资源性能追踪
   */
  trackResourcePerformance() {
    if (!('PerformanceObserver' in window)) return

    try {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          this.processResourceEntry(entry)
        })
      })
      observer.observe({ entryTypes: ['resource'] })
    } catch (e) {
      console.warn('Resource performance tracking not supported:', e)
    }

    // 也处理已存在的资源条目
    if (performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach((entry) => {
        this.processResourceEntry(entry)
      })
    }
  }

  processResourceEntry(entry) {
    const resourceType = this.getResourceType(entry.name, entry.initiatorType)

    // 只追踪重要资源
    if (!this.shouldTrackResource(resourceType, entry)) return

    const resourceData = {
      resource_url: this.sanitizeUrl(entry.name),
      resource_type: resourceType,
      initiator: entry.initiatorType || 'unknown',
      duration: Math.round(entry.duration),
      transfer_size: entry.transferSize || 0,
      encoded_size: entry.encodedBodySize || 0,
      decoded_size: entry.decodedBodySize || 0,
      cache_hit: entry.transferSize === 0 && entry.decodedBodySize > 0,
      session_id: this.sessionId,
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    }

    // 分批发送资源数据以避免过多事件
    this.resourceTimings.push(resourceData)
    if (this.resourceTimings.length >= 10) {
      this.sendResourceBatch()
    }
  }

  getResourceType(url, initiator) {
    if (/\.(css|scss|sass)(\?|$)/i.test(url)) return 'stylesheet'
    if (/\.(js|jsx|ts|tsx)(\?|$)/i.test(url)) return 'script'
    if (/\.(jpg|jpeg|png|gif|svg|webp|avif)(\?|$)/i.test(url)) return 'image'
    if (/\.(woff|woff2|ttf|otf|eot)(\?|$)/i.test(url)) return 'font'
    if (url.includes('/api/')) return 'api'
    if (/\.(json|xml)(\?|$)/i.test(url)) return 'data'

    return initiator || 'other'
  }

  shouldTrackResource(type, entry) {
    // 排除一些不重要的资源
    if (entry.name.includes('chrome-extension://')) return false
    if (entry.name.includes('moz-extension://')) return false
    if (entry.name.includes('analytics')) return false
    if (entry.name.includes('tracking')) return false

    // 只追踪关键资源类型
    const importantTypes = ['stylesheet', 'script', 'image', 'font', 'api', 'data']
    return importantTypes.includes(type)
  }

  sanitizeUrl(url) {
    // 移除查询参数中的敏感信息
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const search = urlObj.search

      // 移除潜在的敏感查询参数
      const sensitiveParams = ['token', 'key', 'secret', 'password', 'auth']
      const searchParams = new URLSearchParams(search)

      sensitiveParams.forEach(param => {
        if (searchParams.has(param)) {
          searchParams.set(param, '[FILTERED]')
        }
      })

      return pathname + (searchParams.toString() ? '?' + searchParams.toString() : '')
    } catch (e) {
      return url.split('?')[0]
    }
  }

  sendResourceBatch() {
    if (this.resourceTimings.length === 0) return

    trackUmami('resource_performance_batch', {
      resources: this.resourceTimings,
      session_id: this.sessionId,
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    })

    this.resourceTimings = []
  }

  /**
   * 网络质量追踪
   */
  trackNetworkQuality() {
    // Network Information API
    if ('connection' in navigator) {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection

      if (connection) {
        trackUmami('network_info', {
          effective_type: connection.effectiveType || 'unknown',
          downlink: connection.downlink || 0,
          rtt: connection.rtt || 0,
          save_data: connection.saveData || false,
          session_id: this.sessionId,
          page_url: window.location.pathname,
          timestamp: new Date().toISOString()
        })

        // 监听网络变化
        connection.addEventListener('change', () => {
          trackUmami('network_change', {
            effective_type: connection.effectiveType || 'unknown',
            downlink: connection.downlink || 0,
            rtt: connection.rtt || 0,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        })
      }
    }
  }

  /**
   * 设备信息追踪
   */
  trackDeviceInfo() {
    const deviceInfo = {
      user_agent: navigator.userAgent,
      platform: navigator.platform || 'unknown',
      language: navigator.language || 'unknown',
      languages: navigator.languages ? navigator.languages.join(',') : 'unknown',
      cpu_cores: navigator.hardwareConcurrency || 0,
      screen_width: screen.width || 0,
      screen_height: screen.height || 0,
      pixel_ratio: window.devicePixelRatio || 1,
      color_depth: screen.colorDepth || 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      session_id: this.sessionId,
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    }

    // 检测是否为移动设备
    deviceInfo.is_mobile = /Mobi|Android/i.test(navigator.userAgent)
    deviceInfo.is_touch = 'ontouchstart' in window

    // 电池状态（如果支持）
    if ('getBattery' in navigator) {
      navigator.getBattery().then((battery) => {
        trackUmami('battery_info', {
          charging: battery.charging,
          level: Math.round(battery.level * 100),
          charging_time: battery.chargingTime,
          discharging_time: battery.dischargingTime,
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      }).catch(() => {
        // Battery API not supported or denied
      })
    }

    trackUmami('device_info', deviceInfo)
  }

  /**
   * 内存使用情况追踪
   */
  trackMemoryUsage() {
    if (!('memory' in performance)) return

    const memoryInfo = performance.memory
    this.memoryInfo = {
      used: Math.round(memoryInfo.usedJSHeapSize / 1024 / 1024), // MB
      total: Math.round(memoryInfo.totalJSHeapSize / 1024 / 1024), // MB
      limit: Math.round(memoryInfo.jsHeapSizeLimit / 1024 / 1024) // MB
    }

    trackUmami('memory_usage', {
      ...this.memoryInfo,
      usage_percentage: Math.round((this.memoryInfo.used / this.memoryInfo.total) * 100),
      session_id: this.sessionId,
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    })

    // 定期检查内存使用情况
    setInterval(() => {
      this.checkMemoryUsage()
    }, 30000) // 30 秒检查一次
  }

  checkMemoryUsage() {
    if (!('memory' in performance)) return

    const memoryInfo = performance.memory
    const currentUsage = Math.round(memoryInfo.usedJSHeapSize / 1024 / 1024)
    const usageIncrease = currentUsage - this.memoryInfo.used

    // 只在内存使用有显著变化时追踪
    if (Math.abs(usageIncrease) > 5) { // 5MB 以上的变化
      trackUmami('memory_change', {
        used: currentUsage,
        change: usageIncrease,
        total: Math.round(memoryInfo.totalJSHeapSize / 1024 / 1024),
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })

      this.memoryInfo.used = currentUsage
    }
  }

  /**
   * JavaScript 错误追踪
   */
  trackScriptErrors() {
    window.addEventListener('error', (event) => {
      this.errorCount++

      trackUmami('javascript_error', {
        error_message: event.message || 'Unknown error',
        error_source: event.filename || 'unknown',
        error_line: event.lineno || 0,
        error_column: event.colno || 0,
        error_stack: event.error ? event.error.stack : 'No stack trace',
        error_count: this.errorCount,
        session_id: this.sessionId,
        page_url: window.location.pathname,
        timestamp: new Date().toISOString()
      })
    })

    // 未捕获的 Promise 拒绝
    window.addEventListener('unhandledrejection', (event) => {
      this.errorCount++

      trackUmami('promise_rejection', {
        error_message: event.reason ? event.reason.toString() : 'Unknown promise rejection',
        error_stack: event.reason && event.reason.stack ? event.reason.stack : 'No stack trace',
        error_count: this.errorCount,
        session_id: this.sessionId,
        page_url: window.location.pathname,
        timestamp: new Date().toISOString()
      })
    })
  }

  /**
   * 自定义时间点追踪
   */
  trackCustomTimings() {
    // 追踪页面交互就绪时间
    document.addEventListener('DOMContentLoaded', () => {
      this.customTimings.dom_ready = performance.now() - this.startTime

      trackUmami('custom_timing', {
        timing_name: 'dom_ready',
        timing_value: Math.round(this.customTimings.dom_ready),
        session_id: this.sessionId,
        page_url: window.location.pathname,
        timestamp: new Date().toISOString()
      })
    })

    // 追踪图片加载完成时间
    window.addEventListener('load', () => {
      this.customTimings.load_complete = performance.now() - this.startTime

      trackUmami('custom_timing', {
        timing_name: 'load_complete',
        timing_value: Math.round(this.customTimings.load_complete),
        session_id: this.sessionId,
        page_url: window.location.pathname,
        timestamp: new Date().toISOString()
      })
    })

    // 追踪第一次用户交互时间
    const trackFirstInteraction = () => {
      if (!this.customTimings.first_interaction) {
        this.customTimings.first_interaction = performance.now() - this.startTime

        trackUmami('custom_timing', {
          timing_name: 'first_interaction',
          timing_value: Math.round(this.customTimings.first_interaction),
          session_id: this.sessionId,
          page_url: window.location.pathname,
          timestamp: new Date().toISOString()
        })

        // 移除监听器，只追踪第一次交互
        document.removeEventListener('click', trackFirstInteraction)
        document.removeEventListener('keydown', trackFirstInteraction)
        document.removeEventListener('touchstart', trackFirstInteraction)
      }
    }

    document.addEventListener('click', trackFirstInteraction)
    document.addEventListener('keydown', trackFirstInteraction)
    document.addEventListener('touchstart', trackFirstInteraction)
  }

  /**
   * 页面可见性追踪
   */
  setupVisibilityTracking() {
    let visibilityStartTime = performance.now()
    let totalVisibleTime = 0

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const visibleDuration = performance.now() - visibilityStartTime
        totalVisibleTime += visibleDuration

        trackUmami('visibility_change', {
          state: 'hidden',
          visible_duration: Math.round(visibleDuration),
          total_visible_time: Math.round(totalVisibleTime),
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      } else {
        visibilityStartTime = performance.now()

        trackUmami('visibility_change', {
          state: 'visible',
          total_visible_time: Math.round(totalVisibleTime),
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      }
    })
  }

  /**
   * 发送性能汇总数据
   */
  sendPerformanceSummary() {
    // 发送剩余的资源数据
    if (this.resourceTimings.length > 0) {
      this.sendResourceBatch()
    }

    const summary = {
      session_id: this.sessionId,
      session_duration: Math.round(performance.now() - this.startTime),
      core_vitals: this.metrics,
      custom_timings: this.customTimings,
      error_count: this.errorCount,
      page_url: window.location.pathname,
      page_type: document.body.getAttribute('data-page-type') || 'page',
      language: document.documentElement.lang || 'en-US',
      timestamp: new Date().toISOString()
    }

    trackUmami('performance_summary', summary)
  }
}

// 自动初始化性能追踪器
let performanceTracker = null

// 等待 DOM 准备完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    performanceTracker = new PerformanceTracker()
  })
} else {
  performanceTracker = new PerformanceTracker()
}

// 导出追踪器供其他脚本使用
window.PerformanceTracker = PerformanceTracker
window.trackPerformanceEvent = trackUmami
