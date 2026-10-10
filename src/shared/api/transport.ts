import type { z } from 'zod'
import { ApiError } from './errors'

export interface Identity {
  token: string | null
  epoch: number
}
export interface TransportOptions {
  base: string
  identity: () => Identity
  onUnauthorized: () => void
  onPasswordRequired: () => void
  fetch?: typeof fetch
}
type AuthPolicy = 'protected' | 'login' | 'password'
export interface RequestOptions {
  method?: string
  json?: unknown
  body?: FormData
  key?: string
  signal?: AbortSignal
  auth?: AuthPolicy
  timeout?: number
}
export function createTransport(options: TransportOptions) {
  if (!/^\/(?!\/)[\w/-]+$/.test(options.base)) throw new Error('API 地址必须是同源路径')
  const active = new Set<AbortController>()
  const assertCurrent = (epoch: number) => {
    if (epoch !== options.identity().epoch) throw new DOMException('身份已改变', 'AbortError')
  }
  async function withResponse<T>(
    path: string,
    request: RequestOptions,
    accept: string,
    consume: (r: Response) => Promise<T>,
  ): Promise<T> {
    if (!/^\/(?!\/)/.test(path) || path.includes('://')) throw new Error('不允许请求外部资源')
    const identity = { ...options.identity() }
    const controller = new AbortController()
    const cancel = () => controller.abort()
    if (request.signal?.aborted) cancel()
    request.signal?.addEventListener('abort', cancel, { once: true })
    active.add(controller)
    const timer = setTimeout(cancel, request.timeout ?? 90_000)
    let requestId: string | null = null
    let responseStatus = 0
    try {
      const headers = new Headers({ Accept: accept })
      if (request.auth !== 'login' && identity.token)
        headers.set('Authorization', `Bearer ${identity.token}`)
      if (request.json !== undefined) headers.set('Content-Type', 'application/json')
      if (request.key) {
        if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(request.key)) throw new Error('幂等键格式错误')
        headers.set('Idempotency-Key', request.key)
      }
      const response = await (options.fetch ?? globalThis.fetch)(options.base + path, {
        method: request.method ?? 'GET',
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
        body:
          request.body ?? (request.json === undefined ? undefined : JSON.stringify(request.json)),
      })
      requestId = response.headers.get('x-request-id')
      responseStatus = response.status
      assertCurrent(identity.epoch)
      if (!response.ok) {
        let code = 'HTTP_ERROR',
          message = `服务请求失败（HTTP ${response.status}）`,
          retryable = false
        if (response.headers.get('content-type')?.includes('application/json')) {
          try {
            const detail: unknown = JSON.parse(await readLimited(response, 64 * 1024))
            if (detail && typeof detail === 'object') {
              const d = detail as Record<string, unknown>
              if (typeof d.code === 'string') code = d.code.slice(0, 100)
              if (typeof d.message === 'string') message = d.message.slice(0, 500)
              retryable = d.retryable === true
            }
          } catch {
            /* A proxy can return HTML or malformed JSON. */
          }
        }
        assertCurrent(identity.epoch)
        if (response.status === 401 && (request.auth ?? 'protected') === 'protected')
          options.onUnauthorized()
        if (code === 'PASSWORD_CHANGE_REQUIRED') options.onPasswordRequired()
        const retry = response.headers.get('retry-after')
        const seconds = retry
          ? /^\d+$/.test(retry)
            ? Number(retry)
            : Math.ceil((Date.parse(retry) - Date.now()) / 1000)
          : NaN
        throw new ApiError(
          message,
          response.status,
          code,
          retryable,
          Number.isFinite(seconds) ? Math.max(1, seconds) : null,
          requestId,
        )
      }
      const result = await consume(response)
      assertCurrent(identity.epoch)
      if (controller.signal.aborted) throw new DOMException('请求已停止或等待超时', 'AbortError')
      return result
    } catch (error) {
      assertCurrent(identity.epoch)
      if (error instanceof ApiError) {
        error.requestId = requestId
        if (!error.status) error.status = responseStatus
      }
      if (controller.signal.aborted)
        throw new DOMException('请求已停止或等待超时，结果需核对', 'AbortError')
      if (error instanceof TypeError)
        throw new ApiError(
          '网络未返回确定结果，请核对后再决定是否重试',
          responseStatus,
          'NETWORK_ERROR',
          false,
          null,
          requestId,
        )
      throw error
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', cancel)
      active.delete(controller)
    }
  }
  return {
    abortAll() {
      active.forEach((controller) => controller.abort())
    },
    json<T>(path: string, schema: z.ZodType<T>, request: RequestOptions = {}) {
      return withResponse(path, request, 'application/json', async (response) => {
        if (!response.headers.get('content-type')?.includes('application/json'))
          throw new ApiError('响应格式不符合接口契约', response.status, 'INVALID_RESPONSE')
        try {
          return schema.parse(JSON.parse(await readLimited(response, 24 * 1024 * 1024)))
        } catch (e) {
          if (e instanceof ApiError) throw e
          throw new ApiError('响应字段不符合契约或包含不安全的数值 ID', 0, 'INVALID_RESPONSE')
        }
      })
    },
    empty(path: string, request: RequestOptions = {}) {
      return withResponse(path, request, '*/*', async (r) => {
        await readLimited(r, 64 * 1024)
      })
    },
    optionalJson<T>(path: string, schema: z.ZodType<T>, request: RequestOptions = {}) {
      return withResponse(path, request, 'application/json', async (response) => {
        if (response.status === 204) return null
        if (!response.headers.get('content-type')?.includes('application/json'))
          throw new ApiError('响应格式不符合接口契约', response.status, 'INVALID_RESPONSE')
        try {
          const parsed = schema.safeParse(JSON.parse(await readLimited(response, 24 * 1024 * 1024)))
          if (!parsed.success) throw new ApiError('响应字段不符合契约', 0, 'INVALID_RESPONSE')
          return parsed.data
        } catch (e) {
          if (e instanceof ApiError) throw e
          throw new ApiError('响应字段不符合契约', response.status, 'INVALID_RESPONSE')
        }
      })
    },
    text(path: string, mime: 'text/plain' | 'text/markdown', request: RequestOptions = {}) {
      return withResponse(path, request, mime, async (r) => {
        if (r.headers.get('content-type')?.split(';')[0]?.trim() !== mime)
          throw new ApiError('附件类型不符合契约', 0, 'INVALID_RESPONSE')
        return readLimited(r, 10 * 1024 * 1024)
      })
    },
    binary(path: string, allowedMimes: readonly string[], request: RequestOptions = {}) {
      return withResponse(path, request, allowedMimes.join(', '), async (r) => {
        const mime = r.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
        if (!allowedMimes.includes(mime))
          throw new ApiError('附件类型不符合契约', 0, 'INVALID_RESPONSE')
        const max = 200 * 1024 * 1024
        if (Number(r.headers.get('content-length')) > max)
          throw new ApiError('附件超过 200 MB 下载上限', 0, 'RESPONSE_TOO_LARGE')
        if (!r.body) throw new ApiError('附件内容为空', 0, 'INVALID_RESPONSE')
        const reader = r.body.getReader(),
          chunks: Uint8Array<ArrayBuffer>[] = []
        let size = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > max) throw new ApiError('附件超过 200 MB 下载上限', 0, 'RESPONSE_TOO_LARGE')
            chunks.push(new Uint8Array(value))
          }
          return {
            blob: new Blob(chunks, { type: mime }),
            checksum: r.headers.get('x-artifact-checksum'),
            revision: r.headers.get('x-artifact-revision'),
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      })
    },
    stream<T>(path: string, request: RequestOptions, consume: (r: Response) => Promise<T>) {
      return withResponse(path, request, 'text/event-stream', async (r) => {
        if (!r.headers.get('content-type')?.includes('text/event-stream') || !r.body)
          throw new ApiError('未获得有效流式响应', 0, 'INVALID_RESPONSE')
        return consume(r)
      })
    },
  }
}
export async function readLimited(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > max) throw new ApiError('响应超过前端读取上限', 0, 'RESPONSE_TOO_LARGE')
  if (!response.body) return ''
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0,
    text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > max) throw new ApiError('响应超过前端读取上限', 0, 'RESPONSE_TOO_LARGE')
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export type Transport = ReturnType<typeof createTransport>
let transport: Transport
export function configureTransport(value: Transport) {
  transport = value
}
export function http() {
  if (!transport) throw new Error('通信尚未初始化')
  return transport
}
