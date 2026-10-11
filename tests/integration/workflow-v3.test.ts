import { describe, it, expect, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { tasksApi } from '@/features/tasks/api'
import { knowledgeApi } from '@/features/knowledge/api'
import { contentPlanSchema, logicalUnits } from '@/shared/api/contracts/contentPlan'
import { learningResultSchema } from '@/shared/api/contracts/learning'
import { compilationSaveSchema, originSchema } from '@/shared/api/contracts/workflow'
import { contentPlan, quizResult, compilationResult } from '../learningFixtures'
import { approval, document, jsonResponse } from '../fixtures'
const scope = { mode: 'SELF' as const, knowledgeBaseIds: [], ownerUserId: null }
function setup(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response)
  configureTransport(
    createTransport({
      base: '/api/v1',
      identity: () => ({ token: 'opaque', epoch: 1 }),
      onUnauthorized: vi.fn(),
      onPasswordRequired: vi.fn(),
      fetch: fetcher,
    }),
  )
  return fetcher
}
describe('Learning V3 business and save workflow', () => {
  it('rejects multi-document quizzes and duplicate compilation inputs before creating a task', () => {
    const f = setup(jsonResponse({}))
    expect(() => tasksApi.create('QUIZ_GENERATION', '', scope, [101, 102], 'key')).toThrow('一份')
    expect(() => tasksApi.create('KNOWLEDGE_COMPILATION', '', scope, [101, 101], 'key')).toThrow(
      '重复',
    )
    expect(f).not.toHaveBeenCalled()
  })
  it('keeps logical counts independent of work packages and rejects incompatible business plans', () => {
    const split = {
      ...contentPlan,
      plan: {
        ...contentPlan.plan,
        execution: { parts: [], packages: [], maximumPackages: 1024, maximumSplitDepth: 8 },
      },
    }
    expect(logicalUnits(contentPlanSchema.parse(split).plan)).toBe(1)
    expect(
      contentPlanSchema.safeParse({
        ...contentPlan,
        plan: { ...contentPlan.plan, compilation: compilationResult.contentPlan.compilation },
      }).success,
    ).toBe(false)
    expect(
      learningResultSchema.safeParse({
        ...quizResult,
        contentPlan: { ...quizResult.contentPlan, version: 2 },
      }).success,
    ).toBe(false)
    expect(learningResultSchema.parse(compilationResult).outline?.chapters[0]?.parentId).toBe('')
  })
  it('reads optional plans and bounded execution pages without triggering mutations', async () => {
    const f = setup(new Response(null, { status: 204 }))
    expect(await tasksApi.readPlan(51)).toBeNull()
    f.mockResolvedValue(jsonResponse([]))
    expect(await tasksApi.workPackages(51, 2)).toEqual([])
    expect(f.mock.calls[1]![0]).toBe('/api/v1/tasks/51/work-packages?page=2&size=20')
    expect(f.mock.calls[1]![1].cache).toBe('no-store')
    expect(() => tasksApi.workPackages(51, -1)).toThrow('页码')
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('prepares only a destination ID using the supplied retry key and checks actual saved document state', async () => {
    const f = setup(jsonResponse({ approval, document: null }))
    await tasksApi.prepareCompilation(51, 12, 'stable-save-key')
    const options = f.mock.calls[0]![1]
    expect(JSON.parse(options.body)).toEqual({ knowledgeBaseId: 12 })
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('stable-save-key')
    f.mockResolvedValue(
      jsonResponse({
        approval: { ...approval, status: 'APPROVED', documentId: 102 },
        document: {
          ...document,
          id: 102,
          ingestionStatus: 'RECEIVED',
          activeProcessingRevision: null,
        },
      }),
    )
    const saved = await tasksApi.compilationSave(approval.approvalId)
    expect(saved.document?.activeProcessingRevision).toBeNull()
    expect(compilationSaveSchema.parse(saved).document?.ingestionStatus).toBe('RECEIVED')
  })
  it('retains historical generation metadata but invalidates edited mappings and paginates permission-filtered participation', async () => {
    const origin = {
      originType: 'KNOWLEDGE_COMPILATION',
      generatedVersion: 1,
      taskId: 51,
      resultHash: 'hash',
      generatedAt: '2026-10-11T00:00:00Z',
      mappingValid: false,
      directSources: [
        { knowledgeBaseId: 12, documentId: 101, documentVersion: 1, sourceOrder: 0, title: '资料' },
      ],
      sections: [],
      bindingStatus: 'INVALIDATED',
      parsedBindings: [],
    }
    const f = setup(jsonResponse(origin))
    expect(originSchema.parse(await knowledgeApi.origin(102)).sections).toEqual([])
    f.mockResolvedValue(jsonResponse([]))
    await knowledgeApi.compilations(101, 3)
    expect(f.mock.calls[1]![0]).toBe('/api/v1/documents/101/compilations?page=3&size=20')
  })
  it('keeps source permission denial explicit without automatic save retries', async () => {
    const f = setup(
      jsonResponse({ code: 'ACCESS_DENIED', message: '来源失效', retryable: false }, 403),
    )
    await expect(tasksApi.prepareCompilation(51, 12, 'stable')).rejects.toMatchObject({
      status: 403,
    })
    expect(f).toHaveBeenCalledOnce()
  })
})
