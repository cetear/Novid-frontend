import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { File as NativeFile } from 'node:buffer'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { knowledgeApi, scopeQuery } from '@/features/knowledge/api'
import { chatApi, dependenciesFrom } from '@/features/chat/api'
import { approvalsApi } from '@/features/approvals/api'
import { tasksApi } from '@/features/tasks/api'
import { memoriesApi } from '@/features/memories/api'
import { adminApi } from '@/features/admin/api'
import { taskActions, isTaskActive } from '@/features/tasks/model'
import { base, document, approval, task, user, ai, jsonResponse } from '../fixtures'
const self = { mode: 'SELF' as const, knowledgeBaseIds: [], ownerUserId: null }
let calls: Array<{ path: string; request: RequestInit; body: unknown }> = []
let response: Response
beforeEach(() => {
  calls = []
  response = jsonResponse(base)
  vi.stubGlobal('File', NativeFile)
  configureTransport(
    createTransport({
      base: '/api/v1',
      identity: () => ({ token: 'opaque', epoch: 1 }),
      onUnauthorized: vi.fn(),
      onPasswordRequired: vi.fn(),
      fetch: vi.fn().mockImplementation((path: string, request: RequestInit) => {
        calls.push({
          path,
          request,
          body: typeof request.body === 'string' ? JSON.parse(request.body) : request.body,
        })
        return Promise.resolve(response)
      }),
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())
describe('exact request construction', () => {
  it('sends only KB update fields with explicit false; deletes with version query', async () => {
    await knowledgeApi.updateBase(base, '新名称', '', false)
    expect(calls[0]?.body).toEqual({ version: 1, name: '新名称', description: '', enabled: false })
    response = new Response('')
    await knowledgeApi.deleteBase(base)
    expect(calls[1]?.path).toBe('/api/v1/knowledge-bases/12?version=1')
    expect(calls[1]?.request.body).toBeUndefined()
  })
  it('sends documentVersion separately from activeProcessingRevision', async () => {
    response = jsonResponse(document)
    await knowledgeApi.updateDocument(
      { document, text: 'original', sourceDependencies: [] },
      '新标题',
      'new',
    )
    expect(calls[0]?.body).toEqual({ documentVersion: 1, title: '新标题', text: 'new' })
    response = new Response('')
    await knowledgeApi.index(101, 'reprocess')
    expect(calls[1]?.path).toBe('/api/v1/documents/101/index-actions?action=reprocess')
    expect(calls[1]?.request.body).toBeUndefined()
    await knowledgeApi.deleteDocument(101, 2)
    expect(calls[2]?.path).toContain('?documentVersion=2')
  })
  it('uploads allowed MIME, exact fields, bearer and same explicit key', async () => {
    response = jsonResponse(document, 202)
    const file = new File(['知识与验证'], 'source.md', { type: '' })
    await knowledgeApi.upload(file, 12, 'same-key')
    const form = calls[0]?.body as FormData
    expect([...form.keys()]).toEqual(['knowledgeBaseId', 'file'])
    expect(form.get('knowledgeBaseId')).toBe('12')
    expect((form.get('file') as File).type).toBe('text/markdown')
    const headers = new Headers(calls[0]?.request.headers)
    expect(headers.get('Idempotency-Key')).toBe('same-key')
    expect(headers.has('Content-Type')).toBe(false)
  })
  it('uses zero-based pagination, explicit zero selected scope, no owner statistics parameter', () => {
    expect(scopeQuery({ mode: 'SELECTED', knowledgeBaseIds: [], ownerUserId: null }, 0)).toBe(
      'scopeMode=SELECTED&knowledgeBaseIds=&page=0&size=20',
    )
    expect(scopeQuery({ mode: 'ALL', knowledgeBaseIds: [], ownerUserId: 9 }, 0, 20, true)).toBe(
      'scopeMode=ALL',
    )
  })
  it('keeps single-round question only and rejects selected empty scope', async () => {
    response = jsonResponse(ai)
    await chatApi.ask('测试问题', self, new AbortController().signal)
    expect(calls[0]?.body).toEqual({ question: '测试问题', scope: self })
    expect(() =>
      chatApi.ask(
        '测试问题',
        { mode: 'SELECTED', knowledgeBaseIds: [], ownerUserId: null },
        new AbortController().signal,
      ),
    ).toThrow('选择')
  })
  it('deduplicates all citation dependencies, never invents statistics sources', () => {
    expect(dependenciesFrom([...ai.citations, ...ai.citations])).toEqual(
      approval.sourceDependencies,
    )
    expect(dependenciesFrom([])).toEqual([])
  })
  it('prepares exact note fields and sends only approved boolean', async () => {
    response = jsonResponse(approval)
    await chatApi.prepare(12, '标题', '正文', approval.sourceDependencies)
    expect(calls[0]?.body).toEqual({
      knowledgeBaseId: 12,
      title: '标题',
      content: '正文',
      sourceDependencies: approval.sourceDependencies,
    })
    response = jsonResponse(approval)
    await approvalsApi.decide('approval-1', false)
    expect(calls[1]?.body).toEqual({ approved: false })
  })
  it('creates raw-document task without requiring READY and uses artifactId for reports', async () => {
    response = jsonResponse(task, 202)
    await tasksApi.create('FAQ', '问题', self, [101], 'task-key')
    expect(calls[0]?.body).toEqual({
      taskType: 'FAQ',
      topic: '问题',
      scope: self,
      documentIds: [101],
    })
    response = jsonResponse(task)
    await tasksApi.action(51, 'pause')
    expect(calls[1]?.body).toEqual({ action: 'pause' })
    response = new Response('# Report', {
      headers: { 'content-type': 'text/markdown;charset=UTF-8' },
    })
    await tasksApi.artifact(83)
    expect(calls[2]?.path).toBe('/api/v1/artifacts/83')
  })
  it('uses memory version query and unpaginated GET; admin update is explicit', async () => {
    const memory = { id: 1, userId: 7, content: '偏好', version: 2 }
    response = jsonResponse(memory)
    await memoriesApi.update(memory, '新偏好')
    expect(calls[0]?.body).toEqual({ version: 2, content: '新偏好' })
    response = new Response('')
    await memoriesApi.delete(memory)
    expect(calls[1]?.path).toBe('/api/v1/memories/1?version=2')
    response = jsonResponse([])
    await memoriesApi.list()
    expect(calls[2]?.path).toBe('/api/v1/memories')
    response = jsonResponse(user)
    await adminApi.update(7, false, 'USER')
    expect(calls[3]?.body).toEqual({ enabled: false, role: 'USER' })
  })
  it('keeps terminal and unknown task states without writable actions', () => {
    for (const status of ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']) {
      expect(taskActions[status]).toEqual([])
      expect(isTaskActive(status)).toBe(false)
    }
    expect(taskActions.FUTURE).toBeUndefined()
    expect(taskActions.PAUSED).toEqual(['resume', 'cancel'])
  })
})
