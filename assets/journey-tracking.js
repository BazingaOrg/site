// 用户旅程分析模块
// 追踪用户完整的访问路径、转化漏斗和行为模式

import { trackUmami } from './events.js'
import { createPrefixedId } from './id.js'

/**
 * 用户旅程追踪器类
 */
class JourneyTracker {
  constructor() {
    this.sessionId = this.generateSessionId()
    this.userId = this.generateOrGetUserId()
    this.sessionStart = Date.now()
    this.pageViews = []
    this.interactions = []
    this.currentPage = this.getCurrentPageInfo()
    this.exitIntentDetected = false
    this.engagementScore = 0
    this.conversionGoals = new Set()
    this.userSegments = []

    // 旅程状态
    this.journeyState = {
      currentFunnel: null,
      funnelStep: 0,
      totalScrollDepth: 0,
      maxScrollDepth: 0,
      timeOnPage: 0,
      idleTime: 0,
      activeTime: 0
    }

    // 预定义的转化漏斗
    this.conversionFunnels = {
      content_discovery: [
        'homepage',
        'content_browse',
        'content_view',
        'content_engage'
      ],
      writing_flow: [
        'homepage',
        'write_entry',
        'write_form_start',
        'write_form_complete',
        'write_submit_success'
      ],
      photo_engagement: [
        'homepage',
        'photos_page',
        'photo_view',
        'photo_interact'
      ]
    }

    this.init()
  }

  generateSessionId() {
    return createPrefixedId('journey')
  }

  generateOrGetUserId() {
    try {
      let userId = localStorage.getItem('user-journey-id')
      if (!userId) {
        userId = createPrefixedId('user')
        localStorage.setItem('user-journey-id', userId)
      }
      return userId
    } catch (error) {
      console.warn('Journey tracker storage unavailable:', error)
      return null
    }
  }

  getCurrentPageInfo() {
    return {
      url: window.location.pathname,
      title: document.title,
      referrer: document.referrer,
      language: document.documentElement.lang || 'en-US',
      pageType: document.body.getAttribute('data-page-type') || 'page',
      timestamp: new Date().toISOString(),
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  }

  init() {
    this.trackPageEntry()
    this.identifyUserSegment()
    this.detectConversionFunnel()
    this.setupEventListeners()
    this.startEngagementTracking()
    this.setupExitIntentDetection()
    this.trackReferrerAnalysis()

    // 设置定期数据同步
    setInterval(() => {
      this.syncJourneyData()
    }, 15000) // 每15秒同步一次数据

    // 页面卸载时保存旅程数据
    window.addEventListener('beforeunload', () => {
      this.trackPageExit()
      this.saveJourneyData()
    })

    // 页面隐藏时也保存数据（移动端）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackPageExit()
        this.saveJourneyData()
      } else {
        this.trackPageResume()
      }
    })
  }

  /**
   * 页面进入追踪
   */
  trackPageEntry() {
    const pageInfo = {
      url: this.currentPage.url,
      title: this.currentPage.title,
      referrer: this.currentPage.referrer,
      language: this.currentPage.language,
      page_type: this.currentPage.pageType,
      timestamp: this.currentPage.timestamp,
      viewport_size: this.currentPage.viewportSize,
      session_id: this.sessionId,
      user_id: this.userId,
      entry_type: this.determineEntryType(),
      device_info: this.getDeviceInfo(),
      geolocation: this.getGeolocationInfo(),
      previous_page: this.getPreviousPageFromHistory()
    }

    this.pageViews.push(pageInfo)

    trackUmami('journey_page_entry', pageInfo)

    // 更新旅程状态
    this.journeyState.timeOnPage = 0
    this.startPageTimer()
  }

  determineEntryType() {
    const referrer = document.referrer
    const currentDomain = window.location.hostname

    if (!referrer) {
      return 'direct'
    }

    if (referrer.includes(currentDomain)) {
      return 'internal'
    }

    if (referrer.includes('google.com') ||
        referrer.includes('bing.com') ||
        referrer.includes('baidu.com')) {
      return 'search_engine'
    }

    if (referrer.includes('twitter.com') ||
        referrer.includes('facebook.com') ||
        referrer.includes('linkedin.com') ||
        referrer.includes('weibo.com')) {
      return 'social_media'
    }

    return 'external'
  }

  getDeviceInfo() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
      isTablet: /iPad|tablet/i.test(navigator.userAgent),
      screenSize: `${screen.width}x${screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio || 1,
      colorDepth: screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  }

  getGeolocationInfo() {
    // 注意：这需要用户授权，应该谨慎使用
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      languages: navigator.languages
    }
  }

  getPreviousPageFromHistory() {
    try {
      const journeyHistory = JSON.parse(localStorage.getItem('journey-history') || '[]')
      return journeyHistory[journeyHistory.length - 1] || null
    } catch (e) {
      return null
    }
  }

  startPageTimer() {
    this.pageStartTime = Date.now()
    this.lastActivityTime = Date.now()

    // 每秒更新页面停留时间
    this.pageTimer = setInterval(() => {
      this.journeyState.timeOnPage = Date.now() - this.pageStartTime

      // 计算活跃时间和空闲时间
      const now = Date.now()
      const timeSinceLastActivity = now - this.lastActivityTime

      if (timeSinceLastActivity > 30000) { // 30秒无活动视为空闲
        this.journeyState.idleTime += 1000
      } else {
        this.journeyState.activeTime += 1000
      }
    }, 1000)
  }

  /**
   * 用户群体识别
   */
  identifyUserSegment() {
    const segments = []

    // 基于访问时间的细分
    const hour = new Date().getHours()
    if (hour >= 6 && hour < 12) {
      segments.push('morning_visitor')
    } else if (hour >= 12 && hour < 18) {
      segments.push('afternoon_visitor')
    } else if (hour >= 18 && hour < 22) {
      segments.push('evening_visitor')
    } else {
      segments.push('night_visitor')
    }

    // 基于设备类型的细分
    const isMobile = /Mobi|Android/i.test(navigator.userAgent)
    const isTablet = /iPad|tablet/i.test(navigator.userAgent)
    if (isMobile) {
      segments.push('mobile_user')
    } else if (isTablet) {
      segments.push('tablet_user')
    } else {
      segments.push('desktop_user')
    }

    // 基于语言的细分
    const lang = document.documentElement.lang || 'en-US'
    segments.push(`${lang.toLowerCase()}_speaker`)

    // 基于入口类型的细分
    const entryType = this.determineEntryType()
    segments.push(`${entryType}_entry`)

    // 基于历史访问的细分
    const visitHistory = this.getVisitHistory()
    if (visitHistory.length === 0) {
      segments.push('first_time_visitor')
    } else if (visitHistory.length < 5) {
      segments.push('new_visitor')
    } else {
      segments.push('returning_visitor')
    }

    this.userSegments = segments

    trackUmami('journey_user_segmentation', {
      session_id: this.sessionId,
      user_id: this.userId,
      segments: segments,
      segment_count: segments.length,
      timestamp: new Date().toISOString()
    })
  }

  getVisitHistory() {
    try {
      return JSON.parse(localStorage.getItem('visit-history') || '[]')
    } catch (e) {
      return []
    }
  }

  /**
   * 转化漏斗检测
   */
  detectConversionFunnel() {
    const currentPage = this.currentPage.url
    const pageType = this.currentPage.pageType

    // 检测用户处于哪个转化漏斗
    for (const [funnelName, steps] of Object.entries(this.conversionFunnels)) {
      const currentStep = this.identifyFunnelStep(currentPage, pageType, steps)

      if (currentStep !== -1) {
        this.journeyState.currentFunnel = funnelName
        this.journeyState.funnelStep = currentStep

        trackUmami('journey_funnel_entry', {
          session_id: this.sessionId,
          user_id: this.userId,
          funnel_name: funnelName,
          current_step: currentStep,
          step_name: steps[currentStep],
          total_steps: steps.length,
          page_url: currentPage,
          timestamp: new Date().toISOString()
        })

        break
      }
    }
  }

  identifyFunnelStep(url, pageType, steps) {
    // 根据URL和页面类型判断用户在漏斗中的位置
    if (url === '/' || url === '/index-zh-CN.html') {
      return steps.indexOf('homepage')
    }

    if (url.includes('/write-') || pageType === 'write') {
      if (steps.includes('write_entry')) return steps.indexOf('write_entry')
    }

    if (url === '/photos.html' || url === '/photos') {
      return steps.indexOf('photos_page')
    }

    if (url === '/notes.html' || url === '/notes') {
      return steps.indexOf('content_browse')
    }

    if (pageType === 'notes' || pageType === 'posts' || pageType === 'stories') {
      return steps.indexOf('content_view')
    }

    return -1
  }

  /**
   * 事件监听器设置
   */
  setupEventListeners() {
    // 点击事件追踪
    document.addEventListener('click', (e) => {
      this.trackInteraction('click', {
        target: e.target.tagName,
        targetClass: e.target.className,
        targetText: e.target.textContent?.trim().substring(0, 100),
        targetHref: e.target.href || null,
        clientX: e.clientX,
        clientY: e.clientY,
        timestamp: Date.now()
      })

      this.updateLastActivity()
    })

    // 滚动事件追踪
    let scrollTimer = null
    document.addEventListener('scroll', () => {
      this.updateLastActivity()

      const scrollTop = window.pageYOffset || document.documentElement.scrollTop
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      const scrollDepth = documentHeight > 0 ? (scrollTop / documentHeight) * 100 : 0

      this.journeyState.totalScrollDepth = Math.max(this.journeyState.totalScrollDepth, scrollDepth)
      this.journeyState.maxScrollDepth = Math.max(this.journeyState.maxScrollDepth, scrollDepth)

      // 防抖：延迟追踪滚动深度里程碑
      clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        this.checkScrollMilestones(scrollDepth)
      }, 150)
    })

    // 键盘事件追踪
    document.addEventListener('keydown', (e) => {
      this.trackInteraction('keydown', {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        timestamp: Date.now()
      })

      this.updateLastActivity()
    })

    // 表单提交追踪
    document.addEventListener('submit', (e) => {
      this.trackConversionGoal('form_submission', {
        form_id: e.target.id,
        form_action: e.target.action,
        form_method: e.target.method
      })
    })

    // 视频/音频交互
    document.addEventListener('play', (e) => {
      if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        this.trackConversionGoal('media_play', {
          media_type: e.target.tagName.toLowerCase(),
          media_src: e.target.src
        })
      }
    })
  }

  trackInteraction(type, data) {
    const interaction = {
      type,
      data,
      timestamp: Date.now(),
      page_url: window.location.pathname,
      session_id: this.sessionId,
      user_id: this.userId
    }

    this.interactions.push(interaction)
    this.updateEngagementScore(type)

    // 批量发送交互数据
    if (this.interactions.length >= 10) {
      this.flushInteractions()
    }
  }

  flushInteractions() {
    if (this.interactions.length === 0) return

    trackUmami('journey_interactions_batch', {
      session_id: this.sessionId,
      user_id: this.userId,
      interactions: this.interactions.slice(),
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    })

    this.interactions = []
  }

  updateLastActivity() {
    this.lastActivityTime = Date.now()
  }

  checkScrollMilestones(scrollDepth) {
    const milestones = [25, 50, 75, 90, 100]

    for (const milestone of milestones) {
      if (scrollDepth >= milestone && !this.scrollMilestones?.[milestone]) {
        this.scrollMilestones = this.scrollMilestones || {}
        this.scrollMilestones[milestone] = true

        trackUmami('journey_scroll_milestone', {
          session_id: this.sessionId,
          user_id: this.userId,
          milestone: milestone,
          scroll_depth: Math.round(scrollDepth),
          time_to_reach: Date.now() - this.pageStartTime,
          page_url: window.location.pathname,
          timestamp: new Date().toISOString()
        })

        this.updateEngagementScore('scroll_milestone')
      }
    }
  }

  /**
   * 开始参与度追踪
   */
  startEngagementTracking() {
    // 追踪鼠标移动 (表示用户活跃)
    let mouseMovements = 0
    document.addEventListener('mousemove', () => {
      mouseMovements++
      this.updateLastActivity()
    }, { passive: true })

    // 定期评估参与度
    setInterval(() => {
      // 基于鼠标移动评估参与度
      if (mouseMovements > 10) {
        this.updateEngagementScore('mouse_activity')
        mouseMovements = 0
      }

      // 基于停留时间评估参与度
      const timeOnPage = Date.now() - this.pageStartTime
      if (timeOnPage > 60000 && timeOnPage % 60000 < 1000) { // 每分钟
        this.updateEngagementScore('time_engagement')
      }
    }, 10000) // 每10秒检查一次
  }

  /**
   * 参与度评分系统
   */
  updateEngagementScore(action) {
    const scoreMap = {
      'click': 1,
      'keydown': 0.5,
      'scroll_milestone': 2,
      'form_focus': 1,
      'form_submission': 5,
      'media_play': 3,
      'social_share': 4,
      'download': 3,
      'external_link': 2,
      'mouse_activity': 0.5,
      'time_engagement': 1
    }

    this.engagementScore += scoreMap[action] || 0
  }

  getEngagementLevel() {
    if (this.engagementScore >= 20) return 'high'
    if (this.engagementScore >= 10) return 'medium'
    if (this.engagementScore >= 5) return 'low'
    return 'minimal'
  }

  /**
   * 转化目标追踪
   */
  trackConversionGoal(goalName, data = {}) {
    if (this.conversionGoals.has(goalName)) return // 避免重复追踪

    this.conversionGoals.add(goalName)

    trackUmami('journey_conversion_goal', {
      session_id: this.sessionId,
      user_id: this.userId,
      goal_name: goalName,
      goal_data: data,
      time_to_conversion: Date.now() - this.sessionStart,
      page_url: window.location.pathname,
      funnel_name: this.journeyState.currentFunnel,
      funnel_step: this.journeyState.funnelStep,
      engagement_score: this.engagementScore,
      user_segments: this.userSegments,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 退出意图检测
   */
  setupExitIntentDetection() {
    let mouseLeaveTimer = null

    document.addEventListener('mouseleave', (e) => {
      if (e.clientY <= 0 && !this.exitIntentDetected) {
        mouseLeaveTimer = setTimeout(() => {
          this.exitIntentDetected = true
          this.trackExitIntent('mouse_leave')
        }, 1000)
      }
    })

    document.addEventListener('mouseenter', () => {
      clearTimeout(mouseLeaveTimer)
    })

    // 快速连续按键（如 Ctrl+W）
    let rapidKeyPresses = 0
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        rapidKeyPresses++
        setTimeout(() => {
          rapidKeyPresses = Math.max(0, rapidKeyPresses - 1)
        }, 1000)

        if (rapidKeyPresses >= 2 && !this.exitIntentDetected) {
          this.exitIntentDetected = true
          this.trackExitIntent('rapid_key_presses')
        }
      }
    })

    // 长时间无活动
    setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime
      if (timeSinceActivity > 300000 && !this.exitIntentDetected) { // 5分钟
        this.exitIntentDetected = true
        this.trackExitIntent('inactivity_timeout')
      }
    }, 60000)
  }

  trackExitIntent(reason) {
    trackUmami('journey_exit_intent', {
      session_id: this.sessionId,
      user_id: this.userId,
      reason: reason,
      time_on_page: Date.now() - this.pageStartTime,
      scroll_depth: this.journeyState.maxScrollDepth,
      engagement_score: this.engagementScore,
      engagement_level: this.getEngagementLevel(),
      interaction_count: this.interactions.length,
      page_url: window.location.pathname,
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 来源分析
   */
  trackReferrerAnalysis() {
    const referrer = document.referrer
    if (!referrer) return

    try {
      const referrerUrl = new URL(referrer)
      const referrerDomain = referrerUrl.hostname
      const searchParams = referrerUrl.searchParams

      const referrerData = {
        session_id: this.sessionId,
        user_id: this.userId,
        referrer_domain: referrerDomain,
        referrer_path: referrerUrl.pathname,
        referrer_full_url: referrer,
        landing_page: window.location.pathname,
        utm_source: searchParams.get('utm_source'),
        utm_medium: searchParams.get('utm_medium'),
        utm_campaign: searchParams.get('utm_campaign'),
        utm_content: searchParams.get('utm_content'),
        utm_term: searchParams.get('utm_term'),
        timestamp: new Date().toISOString()
      }

      trackUmami('journey_referrer_analysis', referrerData)
    } catch (e) {
      // 无效的 referrer URL
    }
  }

  /**
   * 页面退出追踪
   */
  trackPageExit() {
    const exitData = {
      session_id: this.sessionId,
      user_id: this.userId,
      page_url: window.location.pathname,
      time_on_page: Date.now() - this.pageStartTime,
      max_scroll_depth: this.journeyState.maxScrollDepth,
      total_scroll_depth: this.journeyState.totalScrollDepth,
      interaction_count: this.interactions.length,
      engagement_score: this.engagementScore,
      engagement_level: this.getEngagementLevel(),
      exit_type: document.hidden ? 'tab_hidden' : 'page_unload',
      conversion_goals_reached: Array.from(this.conversionGoals),
      active_time: this.journeyState.activeTime,
      idle_time: this.journeyState.idleTime,
      timestamp: new Date().toISOString()
    }

    trackUmami('journey_page_exit', exitData)

    // 清理定时器
    if (this.pageTimer) {
      clearInterval(this.pageTimer)
    }

    // 发送剩余的交互数据
    this.flushInteractions()
  }

  trackPageResume() {
    trackUmami('journey_page_resume', {
      session_id: this.sessionId,
      user_id: this.userId,
      page_url: window.location.pathname,
      total_time_away: Date.now() - this.lastActivityTime,
      timestamp: new Date().toISOString()
    })

    this.updateLastActivity()
    this.startPageTimer()
  }

  /**
   * 数据同步和保存
   */
  syncJourneyData() {
    const journeySnapshot = {
      session_id: this.sessionId,
      user_id: this.userId,
      current_page: this.currentPage,
      journey_state: this.journeyState,
      engagement_score: this.engagementScore,
      engagement_level: this.getEngagementLevel(),
      user_segments: this.userSegments,
      conversion_goals_reached: Array.from(this.conversionGoals),
      total_interactions: this.interactions.length,
      session_duration: Date.now() - this.sessionStart,
      timestamp: new Date().toISOString()
    }

    trackUmami('journey_sync', journeySnapshot)
  }

  saveJourneyData() {
    try {
      // 保存到本地存储供后续分析
      const journeyHistory = JSON.parse(localStorage.getItem('journey-history') || '[]')
      journeyHistory.push({
        url: this.currentPage.url,
        timestamp: Date.now(),
        timeOnPage: Date.now() - this.pageStartTime,
        engagementScore: this.engagementScore
      })

      // 只保留最近50个页面的历史
      if (journeyHistory.length > 50) {
        journeyHistory.splice(0, journeyHistory.length - 50)
      }

      localStorage.setItem('journey-history', JSON.stringify(journeyHistory))

      // 更新访问历史
      const visitHistory = this.getVisitHistory()
      const today = new Date().toDateString()
      if (!visitHistory.includes(today)) {
        visitHistory.push(today)
        if (visitHistory.length > 30) { // 只保留最近30天
          visitHistory.splice(0, visitHistory.length - 30)
        }
        localStorage.setItem('visit-history', JSON.stringify(visitHistory))
      }
    } catch (e) {
      console.warn('Failed to save journey data to localStorage:', e)
    }
  }

  // 获取旅程摘要数据（供其他模块使用）
  getJourneySummary() {
    return {
      session_id: this.sessionId,
      user_id: this.userId,
      session_duration: Date.now() - this.sessionStart,
      page_views: this.pageViews.length,
      total_interactions: this.interactions.length,
      engagement_score: this.engagementScore,
      engagement_level: this.getEngagementLevel(),
      user_segments: this.userSegments,
      current_funnel: this.journeyState.currentFunnel,
      conversion_goals: Array.from(this.conversionGoals),
      max_scroll_depth: this.journeyState.maxScrollDepth
    }
  }
}

// 自动初始化用户旅程追踪器
let journeyTracker = null

document.addEventListener('DOMContentLoaded', () => {
  journeyTracker = new JourneyTracker()

  // 导出到全局供其他模块使用
  window.JourneyTracker = JourneyTracker
  window.journeyTracker = journeyTracker
  window.trackJourneyEvent = trackUmami

  trackUmami('journey_tracker_initialized', {
    session_id: journeyTracker.sessionId,
    user_id: journeyTracker.userId,
    page_url: window.location.pathname,
    user_segments: journeyTracker.userSegments,
    timestamp: new Date().toISOString()
  })
})
