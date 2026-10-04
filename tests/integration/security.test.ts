import { describe, it, expect } from 'vitest'
import { safeMarkdown } from '@/shared/security/markdown'
import {
  positiveId,
  validPassword,
  validBody,
  validRange,
  utf8Length,
} from '@/shared/lib/validation'
import { safeReturn } from '@/shared/lib/routing'
describe('display and input security', () => {
  it('blocks raw HTML, script protocols, remote and data images', () => {
    const html = safeMarkdown(
      '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n![remote](https://example.com/track.png)\n[bad](javascript:alert(1))',
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelectorAll('script,img')).toHaveLength(0)
    expect(doc.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(html).toContain('图片已屏蔽')
  })
  it('marks http links external and adds opener isolation', () => {
    const doc = new DOMParser().parseFromString(
      safeMarkdown('[官网](https://example.com) [相对](/documents/1)'),
      'text/html',
    )
    const link = doc.querySelector('a[href]')!
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(doc.querySelectorAll('a[href]')).toHaveLength(1)
  })
  it('separates UTF-16 password lengths and UTF-8 bytes', () => {
    expect(utf8Length('中')).toBe(3)
    expect(() => validPassword('中'.repeat(25), true)).toThrow('72')
    expect(() => validPassword('中'.repeat(24), true)).not.toThrow()
    expect(() => validPassword('x'.repeat(11), true)).toThrow('12')
  })
  it('counts Unicode code points for body, but UTF-16 for offsets', () => {
    expect(() => validBody('😀'.repeat(600000))).not.toThrow()
    expect(() => validBody('a'.repeat(1000001))).toThrow('100 万')
    expect(validRange('甲😀乙', 1, 3)).toBe(true)
    expect('甲😀乙'.slice(1, 3)).toBe('😀')
    expect(validRange('abc', 1, 4)).toBe(false)
  })
  it('rejects binary controls and unsafe IDs', () => {
    expect(() => validBody('bad\u0000text')).toThrow('控制')
    expect(() => positiveId('9007199254740993')).toThrow('ID')
    expect(() => positiveId('1e3')).toThrow('ID')
  })
  it('restricts login return paths to internal feature routes', () => {
    expect(safeReturn('//evil.example')).toBe('/chat')
    expect(safeReturn('https://evil.example')).toBe('/chat')
    expect(safeReturn('/tasks/51')).toBe('/tasks/51')
    expect(safeReturn('/documents/101?view=source')).toBe('/documents/101?view=source')
  })
})
