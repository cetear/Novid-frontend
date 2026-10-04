export const utf8Length = (text: string) => new TextEncoder().encode(text).length
export function positiveId(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : NaN
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('请输入安全范围内的正整数 ID')
  return n
}
export function parseIds(value: string, max: number) {
  if (!value.trim()) return []
  const ids = [
    ...new Set(
      value
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map(positiveId),
    ),
  ]
  if (ids.length > max) throw new Error(`最多选择 ${max} 项`)
  return ids
}
export function requiredText(value: string, max: number, label: string) {
  if (!value.trim() || value.length > max) throw new Error(`${label}不能为空，且最多 ${max} 个字符`)
}
export function validUsername(value: string) {
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(value))
    throw new Error('用户名须为 3～64 个英文字母、数字、下划线、点或短横线')
}
export function validPassword(value: string, fresh = false) {
  if (!value || utf8Length(value) > 72 || (fresh && (value.length < 12 || value.length > 64)))
    throw new Error(
      fresh
        ? '新密码须为 12～64 个字符，且不超过 72 个 UTF-8 字节'
        : '密码不能为空，且不超过 72 个 UTF-8 字节',
    )
}
export function validBody(text: string) {
  if (
    !text.trim() ||
    utf8Length(text) > 10 * 1024 * 1024 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
  )
    throw new Error('正文须为非空文本，最多 10 MiB，不含二进制控制字符')
  let count = 0
  const iterator = text[Symbol.iterator]()
  while (!iterator.next().done) {
    if (++count > 1_000_000) throw new Error('正文超过 100 万 Unicode 码点')
  }
}
export async function validFile(file: File) {
  if (!/\.(txt|md|markdown)$/i.test(file.name) || file.name.length > 200 || /[\\/]/.test(file.name))
    throw new Error('请选择文件名不超过 200 字符的 TXT 或 Markdown 文件')
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('文件大小须为 1 字节～10 MiB')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new Error('文件必须使用 UTF-8 编码')
  }
  validBody(text)
}
export function validRange(text: string, start: number, end: number) {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end >= start &&
    end <= text.length
  )
}
