import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { createTransport, readLimited } from '@/shared/api/transport'
import { userSchema } from '@/shared/api/contracts/backend'
import { user, jsonResponse } from '../fixtures'
import { chatApi } from '@/features/chat/api'
import { configureTransport } from '@/shared/api/transport'
import { errorMessage } from '@/shared/api/errors'
function setup(fetcher: typeof fetch) {
  const identity = { token: 'opaque', epoch: 1 },
    unauthorized = vi.fn(),
    passwordRequired = vi.fn()
  const api = createTransport({
    base: '/api/v1',
    identity: () => identity,
    fetch: fetcher,
    onUnauthorized: unauthorized,
    onPasswordRequired: passwordRequired,
  })
  return { identity, unauthorized, passwordRequired, api }
}
describe('Transport response and auth boundaries', () => {
  it('preserves HTTP status and request ID for malformed optional JSON', async () => {
    const { api } = setup(
      vi.fn().mockResolvedValue(
        new Response('{broken', {
          headers: { 'content-type': 'application/json', 'X-Request-Id': 'invalid-json-uuid' },
        }),
      ),
    )
    await expect(
      api.optionalJson('/tasks/1/preview', z.object({ id: z.number() })),
    ).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
      requestId: 'invalid-json-uuid',
    })
  })
  it('preserves server error details and request ID without retrying paid calls', async () => {
    const response = jsonResponse(
      { code: 'FEE_LEDGER_UNAVAILABLE', message: '费用账本不可用', retryable: false },
      503,
    )
    response.headers.set('X-Request-Id', 'request-uuid')
    const fetcher = vi.fn().mockResolvedValue(response),
      { api } = setup(fetcher)
    const error = await api.empty('/chat', { method: 'POST' }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      status: 503,
      code: 'FEE_LEDGER_UNAVAILABLE',
      message: '费用账本不可用',
      retryable: false,
      requestId: 'request-uuid',
    })
    expect(errorMessage(error)).toContain('HTTP 503，请求编号 request-uuid')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('adds the initial response request ID to HTTP 200 SSE business errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'event: error\ndata: {"code":"MODEL_UNAVAILABLE","message":"模型不可用","retryable":true}\n\n',
          { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'sse-uuid' } },
        ),
      )
    const { api } = setup(fetcher)
    configureTransport(api)
    await expect(
      chatApi.stream(
        '问题',
        { mode: 'SELF', knowledgeBaseIds: [], ownerUserId: null },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toMatchObject({
      status: 200,
      code: 'MODEL_UNAVAILABLE',
      retryable: true,
      requestId: 'sse-uuid',
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('returns bare arrays without a data wrapper', async () => {
    const { api } = setup(vi.fn().mockResolvedValue(jsonResponse([1, 2])))
    expect(await api.json('/runs', z.array(z.number()))).toEqual([1, 2])
  })
  it('accepts HTTP 200 empty body without parsing JSON', async () => {
    const { api } = setup(vi.fn().mockResolvedValue(new Response('', { status: 200 })))
    expect(await api.empty('/auth/logout', { method: 'POST' })).toBeUndefined()
  })
  it('does not attach credentials on login', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(user)),
      { api } = setup(fetcher)
    await api.json('/auth/login', userSchema, {
      auth: 'login',
      method: 'POST',
      json: { username: 'learner', password: 'private' },
    })
    expect(new Headers(fetcher.mock.calls[0]?.[1].headers).has('Authorization')).toBe(false)
    expect(fetcher.mock.calls[0]?.[1].credentials).toBe('omit')
  })
  it.each(['login', 'password'] as const)('keeps identity after %s 401', async (auth) => {
    const { api, unauthorized } = setup(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'AUTH_REQUIRED', message: '凭证错误', retryable: false }, 401),
        ),
    )
    await expect(api.empty('/auth/password', { auth })).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
  it('invalidates only ordinary protected 401', async () => {
    const { api, unauthorized } = setup(
      vi.fn().mockResolvedValue(jsonResponse({ code: 'AUTH_REQUIRED', message: '失效' }, 401)),
    )
    await expect(api.json('/auth/me', userSchema)).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledOnce()
  })
  it('routes mandatory password change distinctly from resource 403', async () => {
    const { api, passwordRequired, unauthorized } = setup(
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'PASSWORD_CHANGE_REQUIRED', message: '请改密' }, 403),
        ),
    )
    await expect(api.empty('/documents/1')).rejects.toMatchObject({ status: 403 })
    expect(passwordRequired).toHaveBeenCalledOnce()
    expect(unauthorized).not.toHaveBeenCalled()
  })
  it('keeps identity on memory version 403', async () => {
    const { api, unauthorized } = setup(
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ code: 'ACCESS_DENIED', message: '版本不匹配' }, 403)),
    )
    await expect(api.empty('/memories/1')).rejects.toMatchObject({ status: 403 })
    expect(unauthorized).not.toHaveBeenCalled()
  })
  it.each([200, 401])('drops late %i after switching identity', async (status) => {
    let resolve!: (r: Response) => void
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    const { api, identity, unauthorized } = setup(fetcher),
      pending = api.json('/auth/me', userSchema)
    identity.epoch++
    identity.token = 'new-token'
    resolve(jsonResponse(status === 200 ? user : { code: 'AUTH_REQUIRED', message: 'old' }, status))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(unauthorized).not.toHaveBeenCalled()
  })
  it('drops a response if identity changed during body reading', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          body = c
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
    const { api, identity } = setup(vi.fn().mockResolvedValue(response))
    const pending = api.json('/auth/me', userSchema)
    await Promise.resolve()
    identity.epoch++
    body.enqueue(new TextEncoder().encode(JSON.stringify(user)))
    body.close()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects unsafe numerical IDs', async () => {
    const { api } = setup(
      vi.fn().mockResolvedValue(jsonResponse({ ...user, id: Number.MAX_SAFE_INTEGER + 1 })),
    )
    await expect(api.json('/auth/me', userSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
  it('safely decodes HTML proxy errors and Retry-After', async () => {
    const { api } = setup(
      vi.fn().mockResolvedValue(
        new Response('<html>secret diagnostics</html>', {
          status: 429,
          headers: { 'retry-after': '60', 'content-type': 'text/html' },
        }),
      ),
    )
    await expect(api.empty('/tasks/1')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      retryAfter: 60,
      message: '服务请求失败（HTTP 429）',
    })
  })
  it('requires the exact attachment MIME', async () => {
    const { api } = setup(
      vi
        .fn()
        .mockResolvedValue(
          new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } }),
        ),
    )
    await expect(api.text('/artifacts/8', 'text/markdown')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
  it('checks actual response size even without Content-Length', async () => {
    await expect(readLimited(new Response('abcde'), 4)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    })
  })
  it('refuses external URLs with token-bearing transport', async () => {
    const fetcher = vi.fn(),
      { api } = setup(fetcher)
    await expect(api.empty('https://example.com')).rejects.toThrow('外部资源')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('aborts all in-flight requests', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener('abort', () =>
              reject(new DOMException('stopped', 'AbortError')),
            ),
          ),
      )
    const { api } = setup(fetcher),
      pending = api.empty('/runs')
    api.abortAll()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
