import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
const parser = new MarkdownIt({ html: false, linkify: false, breaks: true })
parser.renderer.rules.image = () => '<span class="blocked-image">[图片已屏蔽]</span>'
export function safeMarkdown(text: string) {
  const clean = DOMPurify.sanitize(parser.render(text), {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      's',
      'blockquote',
      'code',
      'pre',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'span',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false,
  })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (!/^https?:\/\//i.test(href)) {
      a.removeAttribute('href')
      return
    }
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.setAttribute('aria-label', `${a.textContent}（外部链接）`)
    a.append(' ↗')
  })
  return doc.body.innerHTML
}
