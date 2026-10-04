import { expect, type Page } from '@playwright/test'
import { user, base, document, ai, approval, task } from '../fixtures'
import { ingestion } from '../stageFixtures'
export async function mockBackend(
  page: Page,
  options: {
    admin?: boolean
    mustChange?: boolean
    oldEvidence?: boolean
    documentEmptyPage?: boolean
    readOnly?: boolean
  } = {},
) {
  const state = {
    user: {
      ...user,
      role: options.admin ? 'ADMIN' : 'USER',
      passwordChangeRequired: !!options.mustChange,
    },
    base: { ...base, ownerUserId: options.readOnly ? 8 : 7 },
    document: { ...document, documentVersion: options.oldEvidence ? 2 : 1 },
    approval: { ...approval },
    task: { ...task },
    reportDenied: false,
    memoryVersion: 1,
    requests: [] as string[],
    bodies: [] as unknown[],
  }
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace('/api/v1', ''),
      method = request.method()
    state.requests.push(method + ' ' + path + url.search)
    let body: Record<string, unknown> = {}
    if (request.headers()['content-type']?.includes('application/json')) {
      body = request.postDataJSON()
      state.bodies.push(body)
    }
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const empty = () => route.fulfill({ status: 200, body: '' })
    if (path !== '/auth/login')
      expect(request.headers().authorization).toBe('Bearer mock-opaque-token')
    if (path === '/auth/login') {
      expect(request.headers().authorization).toBeUndefined()
      if (body.password === 'wrong-password')
        return send({ code: 'AUTH_REQUIRED', message: '用户名或密码错误', retryable: false }, 401)
      return send({
        token: 'mock-opaque-token',
        expiresAt: '2099-01-01T00:00:00Z',
        user: state.user,
      })
    }
    if (path === '/auth/me') return send(state.user)
    if (path === '/sessions' && method === 'GET') return send([])
    if (path === '/tools') return send([])
    if (path === '/documents/101/ingestion')
      return send({
        ...ingestion,
        status: state.document.ingestionStatus,
        errorCode: null,
        processingRevision: state.document.activeProcessingRevision ?? 1,
        progress: null,
      })
    if (path === '/tasks/51/plan') return route.fulfill({ status: 204 })
    if (path === '/auth/logout') return empty()
    if (path === '/auth/password') {
      if (body.oldPassword === 'wrong-password')
        return send({ code: 'AUTH_REQUIRED', message: '原密码错误', retryable: false }, 401)
      return empty()
    }
    if (path === '/knowledge-bases' && method === 'GET')
      return send(state.base.enabled ? [state.base] : [])
    if (path === '/knowledge/statistics')
      return send({ documentCount: 1, receivedCount: 0, readyCount: 1 })
    if (path === '/knowledge-bases/12') {
      if (method === 'PATCH') {
        expect(Object.keys(body).sort()).toEqual(['description', 'enabled', 'name', 'version'])
        Object.assign(state.base, body, { version: state.base.version + 1 })
      }
      return send(state.base)
    }
    if (path === '/documents' && method === 'GET') {
      if (options.documentEmptyPage && url.searchParams.get('page') === '0') return send([])
      return send([state.document])
    }
    if (path === '/documents' && method === 'POST') {
      expect(request.headers()['idempotency-key']).toBeTruthy()
      expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=')
      state.document.ingestionStatus = 'RECEIVED'
      state.document.activeProcessingRevision = null
      return send(
        { ...state.document, ingestionStatus: 'RECEIVED', activeProcessingRevision: null },
        202,
      )
    }
    if (/^\/documents\/(101|102)$/.test(path))
      return send({
        document: { ...state.document, id: path.endsWith('102') ? 102 : 101 },
        text: '知识与验证\n# 步骤\n先验证契约，再整理资料。',
        sourceDependencies: [],
      })
    if (path === '/documents/101/source')
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '知识与验证' })
    if (path === '/chat/stream') {
      expect(Object.keys(body).sort()).toEqual(['question', 'responseFormat', 'scope', 'toolMode'])
      const event = (name: string, data: unknown, id: number) =>
        'id: ' + id + '\nevent: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n'
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body:
          event('progress', { stage: 'processing' }, 1) +
          event('progress', { stage: 'processing' }, 2) +
          event('progress', { stage: 'validated' }, 3) +
          event('delta', { text: '暂时分段' }, 4) +
          event('citation', ai.citations[0], 5) +
          event('done', ai, 6),
      })
    }
    if (path === '/notes/prepare') {
      expect(Object.keys(body).sort()).toEqual([
        'content',
        'knowledgeBaseId',
        'sourceDependencies',
        'title',
      ])
      return send(state.approval)
    }
    if (path === '/approvals/approval-1') return send(state.approval)
    if (path === '/approvals/approval-1/decision') {
      expect(Object.keys(body)).toEqual(['approved'])
      expect(typeof body.approved).toBe('boolean')
      state.approval = {
        ...state.approval,
        status: body.approved ? 'APPROVED' : 'REJECTED',
        documentId: body.approved ? 102 : null,
      }
      return send(state.approval)
    }
    if (path === '/tasks' && method === 'POST') {
      expect(Object.keys(body).sort()).toEqual([
        'documentIds',
        'scope',
        'strategy',
        'taskType',
        'topic',
      ])
      expect(request.headers()['idempotency-key']).toBeTruthy()
      return send(state.task, 202)
    }
    if (path === '/tasks/51') return send(state.task)
    if (path === '/tasks/51/actions') {
      expect(Object.keys(body)).toEqual(['action'])
      state.task = {
        ...state.task,
        status:
          body.action === 'pause' ? 'PAUSED' : body.action === 'resume' ? 'RUNNING' : 'CANCELLED',
        stateVersion: state.task.stateVersion + 1,
      }
      return send(state.task)
    }
    if (path === '/artifacts/83') {
      if (state.reportDenied)
        return send({ code: 'ACCESS_DENIED', message: '来源当前不可读', retryable: false }, 403)
      return route.fulfill({
        status: 200,
        contentType: 'text/markdown',
        body: '# 受控报告\n\n覆盖说明：本次覆盖部分来源。\n\n来源 [D101v1]\n\n![blocked](https://example.com/tracker.png)',
      })
    }
    if (path === '/memories' && method === 'GET')
      return send([{ id: 1, userId: 7, content: '先给结论', version: state.memoryVersion }])
    if (path === '/memories/1' && method === 'PATCH') {
      state.memoryVersion++
      return send({ code: 'ACCESS_DENIED', message: '版本不匹配', retryable: false }, 403)
    }
    if (path === '/admin/users' && method === 'GET') return send([state.user])
    if (path === '/admin/users' && method === 'POST')
      return send({
        user: { ...user, id: 8, username: String(body.username), passwordChangeRequired: true },
        temporaryPassword: 'mock-temporary-123',
      })
    if (path === '/runs') return send([])
    return send(
      { code: 'UNEXPECTED_TEST_REQUEST', message: method + ' ' + path, retryable: false },
      404,
    )
  })
  return state
}
export async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('用户名', { exact: true }).fill('learner')
  await page.getByLabel('密码', { exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: '登录工作台' }).click()
}
