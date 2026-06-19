import { trackUmami } from './events.js'

const trackingScript = document.querySelector('script[data-page-tracking]')

const language =
  trackingScript?.dataset.language ||
  document.documentElement.lang ||
  'en-US'

const pageTitle =
  trackingScript?.dataset.pageTitle ||
  document.title

const pageType =
  trackingScript?.dataset.pageType ||
  'page'

const pageDate =
  trackingScript?.dataset.pageDate ||
  ''

trackUmami('page_meta', {
  language,
  title: pageTitle,
  url: window.location.pathname,
  page_type: pageType,
  page_date: pageDate
}, { scope: 'page-tracking' })

document.addEventListener('click', event => {
  const noteTag = event.target.closest('.note-tag')
  if (noteTag) {
    const tag = noteTag.getAttribute('data-tag')
    if (tag) {
      trackUmami('tag_click', {
        tag,
        current_page: window.location.pathname,
        language
      }, { scope: 'page-tracking' })
    }
  }

  const externalLink = event.target.closest('a[href^="http"]:not([href*="site.bazinga.ink"])')
  if (externalLink) {
    trackUmami('external_link_click', {
      destination: externalLink.getAttribute('href'),
      link_text: externalLink.textContent.trim(),
      current_page: window.location.pathname,
      language
    }, { scope: 'page-tracking' })
  }
})
