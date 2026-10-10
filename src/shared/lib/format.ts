export function dateTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}
export function downloadText(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
export function formatDuration(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return '未知'
  const ms = Math.floor(value)
  return `${Math.floor(ms / 3600000)}小时${Math.floor((ms % 3600000) / 60000)}分钟${Math.floor((ms % 60000) / 1000)}秒${ms % 1000}毫秒`
}
