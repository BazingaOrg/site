// 表单交互追踪模块
// 用于追踪写作表单中的用户行为和互动模式

import { trackUmami } from './events.js'
import { createPrefixedId } from './id.js'

/**
 * 表单交互追踪器类
 */
class FormTracker {
  constructor(formSelector) {
    this.form = document.querySelector(formSelector)
    this.formType = document.body.getAttribute('data-page') || this.form?.closest('[data-page]')?.getAttribute('data-page') || 'unknown'
    this.sessionId = this.generateSessionId()
    this.startTime = Date.now()
    this.isSubmitted = false
    this.fieldFocusTime = {}
    this.fieldChanges = {}
    this.validationErrors = {}
    this.previewViews = 0
    this.tagSelectionBehavior = {
      existing: 0,
      custom: 0,
      combinations: []
    }

    if (this.form) {
      this.init()
    }
  }

  generateSessionId() {
    return createPrefixedId('form')
  }

  init() {
    this.trackFormStart()
    this.setupFieldTracking()
    this.setupTagTracking()
    this.setupPreviewTracking()
    this.setupSubmissionTracking()
    this.setupValidationTracking()
    this.setupAbandonmentTracking()

    // 与旅程追踪器集成
    if (window.journeyTracker) {
      window.journeyTracker.detectConversionFunnel()
    }
  }

  /**
   * 追踪表单开始填写
   */
  trackFormStart() {
    trackUmami('form_start', {
      form_type: this.formType,
      session_id: this.sessionId,
      page_url: window.location.pathname,
      language: document.documentElement.lang || 'en-US',
      timestamp: new Date().toISOString()
    })
  }

  /**
   * 设置表单字段焦点和填写追踪
   */
  setupFieldTracking() {
    const fields = this.form.querySelectorAll('input, textarea, select')

    fields.forEach(field => {
      const fieldName = field.name || field.id

      // 焦点事件追踪
      field.addEventListener('focus', () => {
        this.fieldFocusTime[fieldName] = Date.now()

        trackUmami('field_focus', {
          form_type: this.formType,
          field_name: fieldName,
          field_type: field.type || field.tagName.toLowerCase(),
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      })

      // 失焦事件追踪（计算停留时间）
      field.addEventListener('blur', () => {
        if (this.fieldFocusTime[fieldName]) {
          const focusTime = Date.now() - this.fieldFocusTime[fieldName]

          trackUmami('field_blur', {
            form_type: this.formType,
            field_name: fieldName,
            focus_duration: focusTime,
            field_length: field.value ? field.value.length : 0,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        }
      })

      // 内容变化追踪
      field.addEventListener('input', () => {
        if (!this.fieldChanges[fieldName]) {
          this.fieldChanges[fieldName] = 0
        }
        this.fieldChanges[fieldName]++

        // 只在特定更改次数时追踪（避免过多事件）
        if (this.fieldChanges[fieldName] % 5 === 0 || this.fieldChanges[fieldName] === 1) {
          trackUmami('field_change', {
            form_type: this.formType,
            field_name: fieldName,
            change_count: this.fieldChanges[fieldName],
            field_length: field.value ? field.value.length : 0,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        }
      })
    })
  }

  /**
   * 设置标签选择行为追踪
   */
  setupTagTracking() {
    // 已有标签选择追踪
    const existingTagCheckboxes = this.form.querySelectorAll('.tag-checkbox')
    existingTagCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.tagSelectionBehavior.existing++

          trackUmami('tag_select', {
            form_type: this.formType,
            tag_type: 'existing',
            tag_name: checkbox.value,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        } else {
          trackUmami('tag_unselect', {
            form_type: this.formType,
            tag_type: 'existing',
            tag_name: checkbox.value,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        }
      })
    })

    // 自定义标签输入追踪
    const customTagInput = this.form.querySelector('#custom-tags')
    if (customTagInput) {
      let customTagTimer = null

      customTagInput.addEventListener('input', () => {
        clearTimeout(customTagTimer)
        customTagTimer = setTimeout(() => {
          if (customTagInput.value.trim()) {
            this.tagSelectionBehavior.custom++

            trackUmami('custom_tag_input', {
              form_type: this.formType,
              tag_count: customTagInput.value.split(',').length,
              total_length: customTagInput.value.length,
              session_id: this.sessionId,
              timestamp: new Date().toISOString()
            })
          }
        }, 500) // 500ms 延迟避免频繁触发
      })
    }
  }

  /**
   * 设置预览功能追踪
   */
  setupPreviewTracking() {
    // 监控预览区域的可见性变化
    const previewSection = document.querySelector('.preview-section')
    if (previewSection && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.previewViews++

            trackUmami('preview_view', {
              form_type: this.formType,
              view_count: this.previewViews,
              session_id: this.sessionId,
              timestamp: new Date().toISOString()
            })
          }
        })
      }, { threshold: 0.5 })

      observer.observe(previewSection)
    }

    // 预览内容更新追踪
    const contentField = this.form.querySelector('#content')
    if (contentField) {
      let previewUpdateTimer = null

      contentField.addEventListener('input', () => {
        clearTimeout(previewUpdateTimer)
        previewUpdateTimer = setTimeout(() => {
          trackUmami('preview_update', {
            form_type: this.formType,
            content_length: contentField.value.length,
            word_count: contentField.value.split(/\s+/).length,
            session_id: this.sessionId,
            timestamp: new Date().toISOString()
          })
        }, 1000) // 1秒延迟
      })
    }
  }

  /**
   * 设置表单验证错误追踪
   */
  setupValidationTracking() {
    // 监控表单验证状态
    const form = this.form

    form.addEventListener('invalid', (e) => {
      const field = e.target
      const fieldName = field.name || field.id
      const errorType = field.validity ? this.getValidationErrorType(field.validity) : 'unknown'

      if (!this.validationErrors[fieldName]) {
        this.validationErrors[fieldName] = 0
      }
      this.validationErrors[fieldName]++

      trackUmami('validation_error', {
        form_type: this.formType,
        field_name: fieldName,
        error_type: errorType,
        error_count: this.validationErrors[fieldName],
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
    }, true) // 使用捕获阶段确保能捕获到事件
  }

  /**
   * 获取验证错误类型
   */
  getValidationErrorType(validity) {
    if (validity.valueMissing) return 'required'
    if (validity.tooShort) return 'too_short'
    if (validity.tooLong) return 'too_long'
    if (validity.patternMismatch) return 'pattern'
    if (validity.typeMismatch) return 'type'
    return 'other'
  }

  /**
   * 设置表单提交追踪
   */
  setupSubmissionTracking() {
    this.form.addEventListener('submit', (e) => {
      const completionTime = Date.now() - this.startTime
      const selectedTags = this.getSelectedTags()

      trackUmami('form_submit_attempt', {
        form_type: this.formType,
        completion_time: completionTime,
        field_changes_total: Object.values(this.fieldChanges).reduce((a, b) => a + b, 0),
        validation_errors_total: Object.values(this.validationErrors).reduce((a, b) => a + b, 0),
        preview_views: this.previewViews,
        selected_tags_count: selectedTags.length,
        existing_tags_used: this.tagSelectionBehavior.existing,
        custom_tags_used: this.tagSelectionBehavior.custom,
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })

      // 与旅程追踪器集成 - 追踪表单提交转化目标
      if (window.journeyTracker) {
        window.journeyTracker.trackConversionGoal('form_submission', {
          form_type: this.formType,
          completion_time: completionTime,
          field_changes: Object.values(this.fieldChanges).reduce((a, b) => a + b, 0),
          preview_views: this.previewViews
        })
      }
    })

    // 监听提交成功/失败 (需要与后端配合)
    window.addEventListener('form_submit_success', (e) => {
      const eventFormType = e?.detail?.formType
      if (!eventFormType || eventFormType === this.formType) {
        this.isSubmitted = true
        trackUmami('form_submit_success', {
          form_type: this.formType,
          session_id: this.sessionId,
          content_url: e?.detail?.url || null,
          timestamp: new Date().toISOString()
        })

        // 与旅程追踪器集成 - 追踪成功提交转化目标
        if (window.journeyTracker) {
          window.journeyTracker.trackConversionGoal('write_submit_success', {
            form_type: this.formType,
            total_time: Date.now() - this.startTime,
            content_url: e?.detail?.url || null
          })
        }
      }
    })

    window.addEventListener('form_submit_error', (e) => {
      const eventFormType = e?.detail?.formType
      if (!eventFormType || eventFormType === this.formType) {
        trackUmami('form_submit_error', {
          form_type: this.formType,
          error_message: e?.detail?.error || 'unknown',
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      }
    })
  }

  /**
   * 获取已选中的标签
   */
  getSelectedTags() {
    const selectedTags = []

    // 已有标签
    const checkedBoxes = this.form.querySelectorAll('.tag-checkbox:checked')
    checkedBoxes.forEach(box => {
      selectedTags.push(box.value)
    })

    // 自定义标签
    const customTagInput = this.form.querySelector('#custom-tags')
    if (customTagInput && customTagInput.value.trim()) {
      const customTags = customTagInput.value.split(',').map(tag => tag.trim()).filter(tag => tag)
      selectedTags.push(...customTags)
    }

    return selectedTags
  }

  /**
   * 设置表单放弃追踪
   */
  setupAbandonmentTracking() {
    let isFormActive = false
    let hasInteracted = false

    // 检测用户是否开始与表单交互
    this.form.addEventListener('focusin', () => {
      isFormActive = true
      hasInteracted = true
    })

    this.form.addEventListener('focusout', () => {
      setTimeout(() => {
        // 检查焦点是否仍在表单内
        if (!this.form.contains(document.activeElement)) {
          isFormActive = false
        }
      }, 100)
    })

    // 页面离开时检测表单放弃
    window.addEventListener('beforeunload', () => {
      if (hasInteracted && !this.isSubmitted) {
        const completedFields = this.getCompletedFieldsCount()
        const progressPercentage = this.calculateProgress()

        trackUmami('form_abandon', {
          form_type: this.formType,
          session_duration: Date.now() - this.startTime,
          completed_fields: completedFields,
          progress_percentage: progressPercentage,
          field_changes_total: Object.values(this.fieldChanges).reduce((a, b) => a + b, 0),
          preview_views: this.previewViews,
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      }
    })

    // 页面隐藏时也检测放弃
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && hasInteracted && isFormActive && !this.isSubmitted) {
        trackUmami('form_pause', {
          form_type: this.formType,
          session_duration: Date.now() - this.startTime,
          session_id: this.sessionId,
          timestamp: new Date().toISOString()
        })
      }
    })
  }

  /**
   * 计算已完成的字段数
   */
  getCompletedFieldsCount() {
    const fields = this.form.querySelectorAll('input, textarea, select')
    let completed = 0

    fields.forEach(field => {
      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.checked) completed++
      } else if (field.value && field.value.trim()) {
        completed++
      }
    })

    return completed
  }

  /**
   * 计算表单完成进度
   */
  calculateProgress() {
    const allFields = this.form.querySelectorAll('input, textarea, select')
    const requiredFields = this.form.querySelectorAll('input[required], textarea[required], select[required]')
    const completedRequired = Array.from(requiredFields).filter(field => {
      if (field.type === 'checkbox' || field.type === 'radio') {
        return field.checked
      }
      return field.value && field.value.trim()
    }).length

    return requiredFields.length > 0 ? (completedRequired / requiredFields.length) * 100 : 0
  }
}

// 自动初始化表单追踪器
document.addEventListener('DOMContentLoaded', () => {
  // 检测是否在写作页面
  const writePages = ['write-note']
  const currentPage =
    document.body.getAttribute('data-page') ||
    document.querySelector('[data-page]')?.getAttribute('data-page')

  if (writePages.includes(currentPage)) {
    // 为每种表单类型初始化追踪器
    let formSelector = null

    switch (currentPage) {
      case 'write-note':
        formSelector = '#note-form'
        break
    }

    if (formSelector && document.querySelector(formSelector)) {
      new FormTracker(formSelector)

      // 追踪页面加载完成
      trackUmami('form_page_loaded', {
        form_type: currentPage,
        page_url: window.location.pathname,
        language: document.documentElement.lang || 'en-US',
        timestamp: new Date().toISOString()
      })
    }
  }
})

// 导出追踪函数供其他脚本使用
window.FormTracker = FormTracker
window.trackFormEvent = trackUmami
