// 内容健康度评分系统
// 基于用户行为数据和内容指标评估内容质量和参与度

import { trackUmami } from './events.js'
import { createPrefixedId } from './id.js'

/**
 * 内容健康度评分器类
 */
class ContentHealthScorer {
  constructor() {
    this.sessionId = this.generateSessionId()
    this.currentPage = this.getCurrentPageInfo()
    this.contentMetrics = {
      readability: 0,
      engagement: 0,
      accessibility: 0,
      performance: 0,
      seo: 0,
      userExperience: 0
    }
    this.userBehaviorMetrics = {
      timeOnPage: 0,
      scrollDepth: 0,
      bounceRate: 0,
      interactionRate: 0,
      returnVisitorRate: 0
    }
    this.contentAnalysis = null
    this.healthScore = 0

    this.init()
  }

  generateSessionId() {
    return createPrefixedId('health')
  }

  getCurrentPageInfo() {
    return {
      url: window.location.pathname,
      title: document.title,
      type: document.body.getAttribute('data-page-type') || 'page',
      language: document.documentElement.lang || 'en-US',
      timestamp: new Date().toISOString()
    }
  }

  init() {
    // 等待页面完全加载后开始分析
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.startContentAnalysis()
      })
    } else {
      this.startContentAnalysis()
    }

    // 监听用户行为数据
    this.setupBehaviorTracking()

    // 定期更新健康度评分
    setInterval(() => {
      this.updateHealthScore()
    }, 30000) // 每30秒更新一次

    // 页面卸载时发送最终评分
    window.addEventListener('beforeunload', () => {
      this.sendFinalHealthScore()
    })
  }

  /**
   * 开始内容分析
   */
  startContentAnalysis() {
    this.analyzeReadability()
    this.analyzeAccessibility()
    this.analyzePerformance()
    this.analyzeSEO()
    this.analyzeUserExperience()

    // 初始健康度评分
    this.calculateInitialHealthScore()
  }

  /**
   * 分析内容可读性
   */
  analyzeReadability() {
    const contentElement = this.getMainContentElement()
    if (!contentElement) {
      this.contentMetrics.readability = 50 // 默认中等分数
      return
    }

    const text = contentElement.textContent || ''
    const metrics = {
      wordCount: this.countWords(text),
      sentenceCount: this.countSentences(text),
      paragraphCount: this.countParagraphs(contentElement),
      averageWordsPerSentence: 0,
      averageSentencesPerParagraph: 0,
      complexWords: this.countComplexWords(text),
      readingTime: 0
    }

    // 计算平均值
    metrics.averageWordsPerSentence = metrics.sentenceCount > 0 ?
      metrics.wordCount / metrics.sentenceCount : 0

    metrics.averageSentencesPerParagraph = metrics.paragraphCount > 0 ?
      metrics.sentenceCount / metrics.paragraphCount : 0

    metrics.readingTime = Math.max(1, Math.round(metrics.wordCount / 200)) // 200 words per minute

    // 计算可读性评分 (基于多个因素)
    let readabilityScore = 100

    // 句子长度评分 (理想: 15-20 words)
    if (metrics.averageWordsPerSentence > 25) {
      readabilityScore -= 20
    } else if (metrics.averageWordsPerSentence > 20) {
      readabilityScore -= 10
    }

    // 复杂词汇评分
    const complexWordRatio = metrics.wordCount > 0 ? metrics.complexWords / metrics.wordCount : 0
    if (complexWordRatio > 0.2) {
      readabilityScore -= 15
    } else if (complexWordRatio > 0.1) {
      readabilityScore -= 8
    }

    // 段落结构评分
    if (metrics.paragraphCount === 1 && metrics.sentenceCount > 10) {
      readabilityScore -= 15 // 缺乏段落分割
    }

    // 内容长度评分
    if (metrics.wordCount < 50) {
      readabilityScore -= 10 // 内容过短
    } else if (metrics.wordCount > 2000) {
      readabilityScore -= 5 // 内容可能过长
    }

    this.contentMetrics.readability = Math.max(0, Math.min(100, readabilityScore))

    // 追踪可读性分析结果
    trackUmami('content_readability_analysis', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      metrics: metrics,
      readabilityScore: this.contentMetrics.readability,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 分析可访问性
   */
  analyzeAccessibility() {
    let accessibilityScore = 100
    const issues = []

    // 检查图片 alt 属性
    const images = document.querySelectorAll('img')
    let missingAltCount = 0
    images.forEach(img => {
      if (!img.alt || img.alt.trim() === '') {
        missingAltCount++
      }
    })

    if (missingAltCount > 0) {
      const missingAltRatio = missingAltCount / images.length
      accessibilityScore -= missingAltRatio * 20
      issues.push(`${missingAltCount} images missing alt text`)
    }

    // 检查标题层次结构
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6')
    if (headings.length > 0) {
      let hasH1 = document.querySelector('h1') !== null
      if (!hasH1) {
        accessibilityScore -= 10
        issues.push('Missing H1 heading')
      }

      // 检查标题层次跳跃
      let previousLevel = 0
      let hasSkippedLevel = false
      headings.forEach(heading => {
        const currentLevel = parseInt(heading.tagName.charAt(1))
        if (previousLevel > 0 && currentLevel > previousLevel + 1) {
          hasSkippedLevel = true
        }
        previousLevel = currentLevel
      })

      if (hasSkippedLevel) {
        accessibilityScore -= 8
        issues.push('Heading hierarchy skips levels')
      }
    } else {
      accessibilityScore -= 15
      issues.push('No heading structure')
    }

    // 检查链接文本
    const links = document.querySelectorAll('a')
    let genericLinkCount = 0
    const genericTexts = ['click here', 'read more', 'here', 'more', 'link']

    links.forEach(link => {
      const linkText = link.textContent.trim().toLowerCase()
      if (genericTexts.includes(linkText) || linkText.length < 4) {
        genericLinkCount++
      }
    })

    if (genericLinkCount > 0) {
      const genericLinkRatio = genericLinkCount / links.length
      accessibilityScore -= genericLinkRatio * 15
      issues.push(`${genericLinkCount} links with generic text`)
    }

    // 检查颜色对比度 (简化检查)
    const bodyStyles = window.getComputedStyle(document.body)
    const backgroundColor = bodyStyles.backgroundColor
    const textColor = bodyStyles.color

    // 简单的对比度检查 (实际应用中需要更复杂的计算)
    if (backgroundColor === textColor) {
      accessibilityScore -= 20
      issues.push('Poor color contrast')
    }

    // 检查表单标签
    const formInputs = document.querySelectorAll('input, textarea, select')
    let missingLabelCount = 0
    formInputs.forEach(input => {
      const hasLabel = document.querySelector(`label[for="${input.id}"]`) !== null ||
                      input.closest('label') !== null ||
                      input.getAttribute('aria-label') !== null
      if (!hasLabel) {
        missingLabelCount++
      }
    })

    if (missingLabelCount > 0) {
      accessibilityScore -= (missingLabelCount / formInputs.length) * 15
      issues.push(`${missingLabelCount} form inputs missing labels`)
    }

    this.contentMetrics.accessibility = Math.max(0, Math.min(100, accessibilityScore))

    trackUmami('content_accessibility_analysis', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      accessibilityScore: this.contentMetrics.accessibility,
      issues: issues,
      imagesCount: images.length,
      missingAltCount: missingAltCount,
      headingsCount: headings.length,
      linksCount: links.length,
      genericLinkCount: genericLinkCount,
      formInputsCount: formInputs.length,
      missingLabelCount: missingLabelCount,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 分析性能指标
   */
  analyzePerformance() {
    let performanceScore = 100
    const performanceMetrics = {
      domContentLoaded: 0,
      loadComplete: 0,
      firstContentfulPaint: 0,
      largestContentfulPaint: 0,
      totalResources: 0,
      totalSize: 0
    }

    // 获取导航时序数据
    if (performance.timing) {
      const timing = performance.timing
      performanceMetrics.domContentLoaded = timing.domContentLoadedEventEnd - timing.navigationStart
      performanceMetrics.loadComplete = timing.loadEventEnd - timing.navigationStart
    }

    // 获取 Paint Timing 数据
    if ('PerformanceObserver' in window) {
      try {
        // 获取已有的 Paint 条目（用于 FCP）
        const paintEntries = performance.getEntriesByType('paint')
        paintEntries.forEach(entry => {
          if (entry.name === 'first-contentful-paint') {
            performanceMetrics.firstContentfulPaint = entry.startTime
          }
        })

        // 使用 PerformanceObserver 获取 LCP 数据
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          const lastEntry = entries[entries.length - 1]
          performanceMetrics.largestContentfulPaint = lastEntry.startTime
        })

        try {
          lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
        } catch (e) {
          // 如果不支持 LCP，尝试使用已有的条目
          const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
          if (lcpEntries.length > 0) {
            performanceMetrics.largestContentfulPaint = lcpEntries[lcpEntries.length - 1].startTime
          }
        }

        // 清理观察者（在页面加载完成后）
        if (document.readyState === 'complete') {
          lcpObserver.disconnect()
        } else {
          window.addEventListener('load', () => {
            setTimeout(() => lcpObserver.disconnect(), 100)
          })
        }
      } catch (e) {
        console.warn('Performance API not fully supported')
      }
    }

    // 获取资源加载数据
    const resourceEntries = performance.getEntriesByType('resource')
    performanceMetrics.totalResources = resourceEntries.length
    performanceMetrics.totalSize = resourceEntries.reduce((total, entry) => {
      return total + (entry.transferSize || 0)
    }, 0)

    // 性能评分计算
    // DOM 加载时间评分
    if (performanceMetrics.domContentLoaded > 3000) {
      performanceScore -= 20
    } else if (performanceMetrics.domContentLoaded > 1500) {
      performanceScore -= 10
    }

    // LCP 评分
    if (performanceMetrics.largestContentfulPaint > 4000) {
      performanceScore -= 25
    } else if (performanceMetrics.largestContentfulPaint > 2500) {
      performanceScore -= 15
    }

    // 资源数量评分
    if (performanceMetrics.totalResources > 100) {
      performanceScore -= 15
    } else if (performanceMetrics.totalResources > 50) {
      performanceScore -= 8
    }

    // 总大小评分 (2MB = 2,097,152 bytes)
    if (performanceMetrics.totalSize > 2097152) {
      performanceScore -= 20
    } else if (performanceMetrics.totalSize > 1048576) {
      performanceScore -= 10
    }

    this.contentMetrics.performance = Math.max(0, Math.min(100, performanceScore))

    trackUmami('content_performance_analysis', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      performanceScore: this.contentMetrics.performance,
      metrics: performanceMetrics,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 分析 SEO 指标
   */
  analyzeSEO() {
    let seoScore = 100
    const seoIssues = []

    // 检查标题标签
    const titleTag = document.querySelector('title')
    if (!titleTag || !titleTag.textContent.trim()) {
      seoScore -= 20
      seoIssues.push('Missing title tag')
    } else {
      const titleLength = titleTag.textContent.trim().length
      if (titleLength < 30 || titleLength > 60) {
        seoScore -= 10
        seoIssues.push('Title length not optimal (30-60 chars)')
      }
    }

    // 检查描述标签
    const descriptionTag = document.querySelector('meta[name="description"]')
    if (!descriptionTag || !descriptionTag.content.trim()) {
      seoScore -= 15
      seoIssues.push('Missing meta description')
    } else {
      const descLength = descriptionTag.content.trim().length
      if (descLength < 120 || descLength > 160) {
        seoScore -= 8
        seoIssues.push('Meta description length not optimal (120-160 chars)')
      }
    }

    // 检查 H1 标签
    const h1Tags = document.querySelectorAll('h1')
    if (h1Tags.length === 0) {
      seoScore -= 15
      seoIssues.push('Missing H1 tag')
    } else if (h1Tags.length > 1) {
      seoScore -= 10
      seoIssues.push('Multiple H1 tags')
    }

    // 检查图片 alt 属性 (SEO 角度)
    const images = document.querySelectorAll('img')
    let imagesWithoutAlt = 0
    images.forEach(img => {
      if (!img.alt) {
        imagesWithoutAlt++
      }
    })

    if (imagesWithoutAlt > 0 && images.length > 0) {
      const missingAltRatio = imagesWithoutAlt / images.length
      seoScore -= missingAltRatio * 10
      seoIssues.push(`${imagesWithoutAlt} images without alt text`)
    }

    // 检查内部链接
    const internalLinks = document.querySelectorAll('a[href^="/"], a[href^="./"], a[href^="../"]')
    const externalLinks = document.querySelectorAll('a[href^="http"]:not([href*="site.bazinga.ink"])')

    const linkMetrics = {
      internal: internalLinks.length,
      external: externalLinks.length,
      total: document.querySelectorAll('a[href]').length
    }

    if (linkMetrics.internal === 0 && linkMetrics.total > 0) {
      seoScore -= 8
      seoIssues.push('No internal links found')
    }

    // 检查结构化数据 (简单检查)
    const structuredData = document.querySelectorAll('script[type="application/ld+json"]')
    if (structuredData.length === 0) {
      seoScore -= 5
      seoIssues.push('No structured data found')
    }

    // 检查 Open Graph 标签
    const ogTitle = document.querySelector('meta[property="og:title"]')
    const ogDescription = document.querySelector('meta[property="og:description"]')
    const ogImage = document.querySelector('meta[property="og:image"]')

    let missingOgTags = 0
    if (!ogTitle) missingOgTags++
    if (!ogDescription) missingOgTags++
    if (!ogImage) missingOgTags++

    if (missingOgTags > 0) {
      seoScore -= missingOgTags * 3
      seoIssues.push(`Missing ${missingOgTags} Open Graph tags`)
    }

    this.contentMetrics.seo = Math.max(0, Math.min(100, seoScore))

    trackUmami('content_seo_analysis', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      seoScore: this.contentMetrics.seo,
      issues: seoIssues,
      titleLength: titleTag ? titleTag.textContent.trim().length : 0,
      descriptionLength: descriptionTag ? descriptionTag.content.trim().length : 0,
      h1Count: h1Tags.length,
      imageCount: images.length,
      imagesWithoutAlt: imagesWithoutAlt,
      linkMetrics: linkMetrics,
      structuredDataCount: structuredData.length,
      missingOgTags: missingOgTags,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 分析用户体验
   */
  analyzeUserExperience() {
    let uxScore = 100
    const uxIssues = []

    // 检查移动端友好性
    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (!viewportMeta) {
      uxScore -= 15
      uxIssues.push('Missing viewport meta tag')
    }

    // 检查字体大小
    const bodyFontSize = parseFloat(window.getComputedStyle(document.body).fontSize)
    if (bodyFontSize < 14) {
      uxScore -= 10
      uxIssues.push('Font size too small for readability')
    }

    // 检查点击目标大小
    const clickableElements = document.querySelectorAll('a, button, input[type="submit"], input[type="button"]')
    let smallClickTargets = 0

    clickableElements.forEach(element => {
      const rect = element.getBoundingClientRect()
      const minSize = Math.min(rect.width, rect.height)
      if (minSize < 44) { // 44px is recommended minimum touch target size
        smallClickTargets++
      }
    })

    if (smallClickTargets > 0) {
      const smallTargetRatio = smallClickTargets / clickableElements.length
      uxScore -= smallTargetRatio * 15
      uxIssues.push(`${smallClickTargets} click targets too small`)
    }

    // 检查内容密度
    const contentElement = this.getMainContentElement()
    if (contentElement) {
      const contentHeight = contentElement.scrollHeight
      const viewportHeight = window.innerHeight
      const contentDensity = contentHeight / viewportHeight

      if (contentDensity > 5) {
        uxScore -= 8
        uxIssues.push('Content too dense for comfortable reading')
      }
    }

    // 检查加载指示器
    const loadingIndicators = document.querySelectorAll('[class*="loading"], [class*="spinner"], [aria-live]')
    if (loadingIndicators.length === 0) {
      uxScore -= 5
      uxIssues.push('No loading indicators found')
    }

    // 检查错误处理
    const errorElements = document.querySelectorAll('[role="alert"], .error, .warning')
    const hasErrorHandling = errorElements.length > 0 ||
                            document.querySelectorAll('[aria-invalid]').length > 0

    if (!hasErrorHandling) {
      uxScore -= 5
      uxIssues.push('No error handling elements found')
    }

    this.contentMetrics.userExperience = Math.max(0, Math.min(100, uxScore))

    trackUmami('content_ux_analysis', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      uxScore: this.contentMetrics.userExperience,
      issues: uxIssues,
      hasViewportMeta: !!viewportMeta,
      bodyFontSize: bodyFontSize,
      clickableElementsCount: clickableElements.length,
      smallClickTargets: smallClickTargets,
      contentDensity: contentElement ? (contentElement.scrollHeight / window.innerHeight) : 0,
      loadingIndicatorsCount: loadingIndicators.length,
      hasErrorHandling: hasErrorHandling,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 设置用户行为追踪
   */
  setupBehaviorTracking() {
    let startTime = Date.now()
    let maxScrollDepth = 0
    let interactionCount = 0

    // 追踪时间
    const updateTimeOnPage = () => {
      this.userBehaviorMetrics.timeOnPage = Date.now() - startTime
    }

    setInterval(updateTimeOnPage, 1000)

    // 追踪滚动深度
    const trackScroll = () => {
      const scrollTop = window.pageYOffset
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      const scrollPercentage = documentHeight > 0 ? (scrollTop / documentHeight) * 100 : 100

      maxScrollDepth = Math.max(maxScrollDepth, scrollPercentage)
      this.userBehaviorMetrics.scrollDepth = maxScrollDepth
    }

    window.addEventListener('scroll', trackScroll, { passive: true })

    // 追踪交互
    const trackInteraction = () => {
      interactionCount++
      this.userBehaviorMetrics.interactionRate = interactionCount /
        Math.max(1, (Date.now() - startTime) / 1000) // interactions per second
    }

    document.addEventListener('click', trackInteraction)
    document.addEventListener('keydown', trackInteraction)
    document.addEventListener('touchstart', trackInteraction)

    // 获取访问历史信息
    const visitHistory = this.getVisitHistory()
    this.userBehaviorMetrics.returnVisitorRate = visitHistory.length > 1 ? 1 : 0

    // 页面卸载时计算跳出率
    window.addEventListener('beforeunload', () => {
      updateTimeOnPage()
      // 如果用户停留时间少于30秒且滚动深度小于25%，视为跳出
      const timeThreshold = 30000 // 30 seconds
      const scrollThreshold = 25 // 25%

      this.userBehaviorMetrics.bounceRate =
        (this.userBehaviorMetrics.timeOnPage < timeThreshold &&
         this.userBehaviorMetrics.scrollDepth < scrollThreshold) ? 1 : 0
    })
  }

  /**
   * 计算初始健康度评分
   */
  calculateInitialHealthScore() {
    const weights = {
      readability: 0.2,
      engagement: 0.15,
      accessibility: 0.2,
      performance: 0.2,
      seo: 0.15,
      userExperience: 0.1
    }

    // 初始参与度评分基于内容质量
    this.contentMetrics.engagement = this.calculateEngagementScore()

    this.healthScore =
      (this.contentMetrics.readability * weights.readability) +
      (this.contentMetrics.engagement * weights.engagement) +
      (this.contentMetrics.accessibility * weights.accessibility) +
      (this.contentMetrics.performance * weights.performance) +
      (this.contentMetrics.seo * weights.seo) +
      (this.contentMetrics.userExperience * weights.userExperience)

    trackUmami('content_initial_health_score', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      healthScore: Math.round(this.healthScore),
      contentMetrics: this.contentMetrics,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 更新健康度评分 (包含用户行为数据)
   */
  updateHealthScore() {
    // 重新计算参与度评分 (包含用户行为)
    this.contentMetrics.engagement = this.calculateEngagementScore()

    const weights = {
      readability: 0.18,
      engagement: 0.25, // 增加参与度权重
      accessibility: 0.18,
      performance: 0.17,
      seo: 0.12,
      userExperience: 0.1
    }

    this.healthScore =
      (this.contentMetrics.readability * weights.readability) +
      (this.contentMetrics.engagement * weights.engagement) +
      (this.contentMetrics.accessibility * weights.accessibility) +
      (this.contentMetrics.performance * weights.performance) +
      (this.contentMetrics.seo * weights.seo) +
      (this.contentMetrics.userExperience * weights.userExperience)

    trackUmami('content_health_score_update', {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      healthScore: Math.round(this.healthScore),
      contentMetrics: this.contentMetrics,
      userBehaviorMetrics: this.userBehaviorMetrics,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 计算参与度评分
   */
  calculateEngagementScore() {
    let engagementScore = 50 // 基础分数

    // 时间因子
    const timeMinutes = this.userBehaviorMetrics.timeOnPage / 60000
    if (timeMinutes > 5) {
      engagementScore += 20
    } else if (timeMinutes > 2) {
      engagementScore += 15
    } else if (timeMinutes > 1) {
      engagementScore += 10
    }

    // 滚动深度因子
    if (this.userBehaviorMetrics.scrollDepth > 75) {
      engagementScore += 15
    } else if (this.userBehaviorMetrics.scrollDepth > 50) {
      engagementScore += 10
    } else if (this.userBehaviorMetrics.scrollDepth > 25) {
      engagementScore += 5
    }

    // 交互率因子
    if (this.userBehaviorMetrics.interactionRate > 0.1) { // 0.1 interactions per second
      engagementScore += 10
    } else if (this.userBehaviorMetrics.interactionRate > 0.05) {
      engagementScore += 5
    }

    // 跳出率因子 (反向)
    if (this.userBehaviorMetrics.bounceRate === 0) {
      engagementScore += 10
    } else {
      engagementScore -= 15
    }

    // 回访因子
    if (this.userBehaviorMetrics.returnVisitorRate > 0) {
      engagementScore += 5
    }

    // 与旅程追踪器集成
    if (window.journeyTracker) {
      const journeySummary = window.journeyTracker.getJourneySummary()
      if (journeySummary.engagement_level === 'high') {
        engagementScore += 15
      } else if (journeySummary.engagement_level === 'medium') {
        engagementScore += 8
      }

      // 转化目标达成加分
      if (journeySummary.conversion_goals.length > 0) {
        engagementScore += journeySummary.conversion_goals.length * 5
      }
    }

    return Math.max(0, Math.min(100, engagementScore))
  }

  /**
   * 发送最终健康度评分
   */
  sendFinalHealthScore() {
    this.updateHealthScore()

    const finalReport = {
      sessionId: this.sessionId,
      pageUrl: this.currentPage.url,
      pageType: this.currentPage.type,
      finalHealthScore: Math.round(this.healthScore),
      contentMetrics: this.contentMetrics,
      userBehaviorMetrics: this.userBehaviorMetrics,
      healthCategory: this.getHealthCategory(this.healthScore),
      recommendations: this.generateRecommendations(),
      sessionDuration: this.userBehaviorMetrics.timeOnPage,
      timestamp: new Date().toISOString()
    }

    trackUmami('content_final_health_report', finalReport)
  }

  /**
   * 获取健康度类别
   */
  getHealthCategory(score) {
    if (score >= 90) return 'excellent'
    if (score >= 80) return 'good'
    if (score >= 70) return 'fair'
    if (score >= 60) return 'poor'
    return 'critical'
  }

  /**
   * 生成改进建议
   */
  generateRecommendations() {
    const recommendations = []

    if (this.contentMetrics.readability < 70) {
      recommendations.push('Improve content readability: shorter sentences, simpler words, better paragraph structure')
    }

    if (this.contentMetrics.accessibility < 70) {
      recommendations.push('Enhance accessibility: add alt text, improve heading structure, ensure proper form labels')
    }

    if (this.contentMetrics.performance < 70) {
      recommendations.push('Optimize performance: reduce resource count, compress images, improve loading times')
    }

    if (this.contentMetrics.seo < 70) {
      recommendations.push('Improve SEO: optimize title and meta description, add structured data, improve internal linking')
    }

    if (this.contentMetrics.userExperience < 70) {
      recommendations.push('Enhance user experience: ensure mobile responsiveness, larger click targets, better error handling')
    }

    if (this.userBehaviorMetrics.bounceRate > 0.7) {
      recommendations.push('Reduce bounce rate: improve content engagement, clearer navigation, faster loading')
    }

    return recommendations
  }

  // 辅助方法
  getMainContentElement() {
    return document.querySelector('main article, .note-content, .post-content, main') ||
           document.querySelector('main') ||
           document.body
  }

  countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length
  }

  countSentences(text) {
    return text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0).length
  }

  countParagraphs(element) {
    return element.querySelectorAll('p').length || 1
  }

  countComplexWords(text) {
    // 简单的复杂词汇检测 (超过3个音节或特殊词汇)
    const words = text.toLowerCase().split(/\s+/)
    return words.filter(word => {
      return word.length > 8 ||
             /[^aeiou]{3,}/.test(word) || // 连续辅音
             /\w{12,}/.test(word) // 超长单词
    }).length
  }

  getVisitHistory() {
    try {
      return JSON.parse(localStorage.getItem('visit-history') || '[]')
    } catch (e) {
      return []
    }
  }

  // 获取健康度评分供其他模块使用
  getCurrentHealthScore() {
    return {
      overallScore: this.healthScore,
      category: this.getHealthCategory(this.healthScore),
      metrics: this.contentMetrics,
      userBehavior: this.userBehaviorMetrics,
      recommendations: this.generateRecommendations()
    }
  }
}

// 自动初始化内容健康度评分器
let contentHealthScorer = null

document.addEventListener('DOMContentLoaded', () => {
  contentHealthScorer = new ContentHealthScorer()

  // 导出到全局供其他模块使用
  window.ContentHealthScorer = ContentHealthScorer
  window.contentHealthScorer = contentHealthScorer
  window.trackContentHealth = trackUmami

  trackUmami('content_health_scorer_initialized', {
    sessionId: contentHealthScorer.sessionId,
    pageUrl: window.location.pathname,
    pageType: document.body.getAttribute('data-page-type') || 'page',
    timestamp: new Date().toISOString()
  })
})
