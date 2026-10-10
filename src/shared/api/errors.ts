export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = 'NETWORK_ERROR',
    public retryable = false,
    public retryAfter: number | null = null,
    public requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError)
    return `${error.message}（${error.code}${error.status ? `，HTTP ${error.status}` : ''}${error.retryAfter ? `，请 ${error.retryAfter} 秒后再试` : ''}${error.requestId ? `，请求编号 ${error.requestId}` : ''}）`
  return error instanceof Error ? error.message : '操作未完成，请稍后手动重试'
}
export function isAbort(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}
