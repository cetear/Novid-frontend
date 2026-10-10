import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { sessionsApi } from '@/features/chat/sessionsApi'
import { chatApi } from '@/features/chat/api'
import { tasksApi } from '@/features/tasks/api'
import { knowledgeApi } from '@/features/knowledge/api'
import { runsApi } from '@/features/runs/api'
import { duration, knownUsage, nodeRows } from '@/features/runs/model'
import { graphSchema, sessionMessageSchema, type TraceGraph } from '@/shared/api/contracts/backend'
import { contentPlan } from '../learningFixtures'
import { ai, jsonResponse, task } from '../fixtures'
import { graph, session, ingestion, sectionPage } from '../stageFixtures'
const self = { mode: 'SELF' as const, knowledgeBaseIds: [], ownerUserId: null }
let response: Response
const calls: Array<{ path: string; options: RequestInit; body: unknown }> = []
beforeEach(() => {
  calls.length = 0
  response = jsonResponse(ai)
  configureTransport(
    createTransport({
      base: '/api/v1',
      identity: () => ({ token: 'opaque', epoch: 1 }),
      onUnauthorized: vi.fn(),
      onPasswordRequired: vi.fn(),
      fetch: vi.fn().mockImplementation((path: string, options: RequestInit) => {
        calls.push({
          path,
          options,
          body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
        })
        return Promise.resolve(response)
      }),
    }),
  )
})
describe('S01–S06 protocol extensions', () => {
  it('creates with an explicit stable key, reads a sequence cursor and deletes with version / 204', async () => {
    response = jsonResponse(session, 201)
    await sessionsApi.create('备份规则', 'session-key')
    expect(calls[0]?.body).toEqual({ title: '备份规则' })
    expect(new Headers(calls[0]?.options.headers).get('Idempotency-Key')).toBe('session-key')
    response = jsonResponse([])
    await sessionsApi.messages(701, 18)
    expect(calls[1]?.path).toBe('/api/v1/sessions/701/messages?afterSeq=18&size=20')
    response = new Response(null, { status: 204 })
    await sessionsApi.delete(701, 3)
    expect(calls[2]?.path).toBe('/api/v1/sessions/701?version=3')
    expect(calls[2]?.options.method).toBe('DELETE')
  })
  it('sends only approved session/model fields and preserves returned version and route', async () => {
    response = jsonResponse({ ...ai, sessionId: 701, sessionVersion: 4, route: null })
    const result = await chatApi.ask('继续解释', self, new AbortController().signal, {
      sessionId: 701,
      sessionVersion: 3,
      modelProfile: 'analysis',
      responseFormat: 'TEXT',
      toolMode: 'READ_ONLY',
    })
    expect(result.sessionVersion).toBe(4)
    expect(calls[0]?.body).toEqual({
      question: '继续解释',
      scope: self,
      sessionId: 701,
      sessionVersion: 3,
      modelProfile: 'analysis',
      responseFormat: 'TEXT',
      toolMode: 'READ_ONLY',
    })
    expect(() =>
      chatApi.ask('问题', self, new AbortController().signal, { sessionId: 701 }),
    ).toThrow('同时')
    expect(() =>
      chatApi.ask('问题', self, new AbortController().signal, {
        toolMode: 'READ_ONLY',
        responseFormat: 'STRUCTURED',
      }),
    ).toThrow('文本')
  })
  it('distinguishes absent plan 204 from an accepted content plan and requires FIXED for learning', async () => {
    response = new Response(null, { status: 204 })
    expect(await tasksApi.contentPlan(51)).toBeNull()
    response = jsonResponse(contentPlan)
    expect((await tasksApi.contentPlan(51))?.planHash).toBe(contentPlan.planHash)
    response = jsonResponse(task, 202)
    await tasksApi.create('KNOWLEDGE_COMPILATION', '主题', self, [101], 'key', 'FIXED')
    expect(calls.at(-1)?.body).toMatchObject({ strategy: 'FIXED' })
    expect(() => tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'key', 'PLANNED')).toThrow(
      '固定流程',
    )
  })
  it('keeps section version/revision pinned and recovery tied to the same revision', async () => {
    response = jsonResponse(sectionPage)
    await knowledgeApi.section(101, 'section/一', 2, 3, 12)
    expect(calls[0]?.path).toContain(
      '/sections/section%2F%E4%B8%80?documentVersion=2&processingRevision=3&maxTokens=4000&afterOffset=12',
    )
    response = jsonResponse(ingestion)
    expect((await knowledgeApi.ingestion(101)).progress?.unknownBatches).toBe(0)
    response = new Response('')
    await knowledgeApi.recover(101, 3)
    expect(calls.at(-1)?.path).toBe(
      '/api/v1/documents/101/index-actions?action=recover&processingRevision=3',
    )
    expect(calls.at(-1)?.options.body).toBeUndefined()
  })
  it('reads private graphs without browser cache and validates safe IDs', async () => {
    response = jsonResponse(graph)
    expect((await runsApi.graph('trace-1')).nodes.length).toBe(3)
    expect(calls[0]?.options.cache).toBe('no-store')
    expect(
      graphSchema.safeParse({ ...graph, run: { ...graph.run, actorUserId: 1e20 } }).success,
    ).toBe(false)
  })
  it('accepts restricted history placeholders without requiring inaccessible content', () => {
    expect(
      sessionMessageSchema.parse({
        seq: 2,
        role: 'ASSISTANT',
        status: 'RESTRICTED',
        content: null,
        sourceDependencies: [],
        sourceReferences: [],
        toolCallId: null,
        toolName: null,
        createdAt: session.createdAt,
        scope: self,
      }).content,
    ).toBeNull()
  })
  it('counts only provider leaf usage, excludes parents/simulation and retains unknown facts', () => {
    const value: TraceGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          ...graph.nodes[1]!,
          spanId: 'unknown',
          usageSource: 'UNKNOWN',
          inputTokens: null,
          outputTokens: null,
        },
        {
          ...graph.nodes[1]!,
          spanId: 'sim',
          usageSource: 'SIMULATED',
          inputTokens: 999,
          outputTokens: 999,
        },
      ],
    }
    expect(knownUsage(value)).toEqual({ input: 10, output: 5, unknown: 1, simulated: 1 })
    expect(duration({ ...graph.nodes[1]!, endedAt: null })).toBeNull()
    expect(
      nodeRows([{ ...graph.nodes[0]!, parentSpanId: graph.nodes[0]!.spanId }])[0]?.brokenParent,
    ).toBe(true)
  })
})
