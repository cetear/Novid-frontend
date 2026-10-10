import { describe, it, expect, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { tasksApi } from '@/features/tasks/api'
import { learningResultSchema } from '@/shared/api/contracts/learning'
import { taskSchema } from '@/shared/api/contracts/backend'
import { isRetiredTask } from '@/features/tasks/model'
import { learningTask, quizResult, compilationResult } from '../learningFixtures'
import { jsonResponse } from '../fixtures'
const self = { mode: 'SELF' as const, knowledgeBaseIds: [], ownerUserId: null }
function setup(response = jsonResponse(learningTask, 202)) {
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
describe('Current learning protocol', () => {
  it('uses source-only requests with optional trimmed remarks and automatic quantities', async () => {
    const fetcher = setup()
    await tasksApi.create('QUIZ_GENERATION', '   ', self, [101], 'auto-key')
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      taskType: 'QUIZ_GENERATION',
      scope: self,
      documentIds: [101],
    })
    fetcher.mockResolvedValue(jsonResponse(learningTask, 202))
    await tasksApi.create(
      'KNOWLEDGE_COMPILATION',
      '  供初学者复习  ',
      self,
      [101],
      'remarks-key',
      'FIXED',
      { compilationOptions: { detailLevel: 'DETAILED', maximumChapters: 0 } },
    )
    const body = JSON.parse(fetcher.mock.calls[1]![1].body)
    expect(body.remarks).toBe('供初学者复习')
    expect(body).not.toHaveProperty('topic')
    expect(body).not.toHaveProperty('requestVersion')
    expect(() => tasksApi.create('QUIZ_GENERATION', '字'.repeat(1001), self, [101], 'key')).toThrow(
      '备注',
    )
  })
  it('supports explicit 512 and automatic zero without imposing the old count caps', async () => {
    const fetcher = setup()
    await tasksApi.create('QUIZ_GENERATION', '', self, [101], 'key', 'FIXED', {
      quizOptions: { questionCount: 512, questionTypes: ['SHORT_ANSWER'], difficulty: 'MEDIUM' },
    })
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).quizOptions.questionCount).toBe(512)
    fetcher.mockResolvedValue(jsonResponse(learningTask, 202))
    await tasksApi.create('QUIZ_GENERATION', '', self, [101], 'key-2', 'FIXED', {
      quizOptions: { questionCount: 0, questionTypes: ['SHORT_ANSWER'], difficulty: 'MEDIUM' },
    })
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).quizOptions.questionCount).toBe(0)
  })
  it('sends complete quiz options and preserves the same key for an explicit retry', async () => {
    const fetcher = setup()
    const options = {
      quizOptions: {
        questionCount: 10,
        questionTypes: ['SINGLE_CHOICE', 'SHORT_ANSWER'] as ('SINGLE_CHOICE' | 'SHORT_ANSWER')[],
        difficulty: 'MEDIUM' as const,
      },
    }
    await tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'stable-key', 'FIXED', options)
    fetcher.mockResolvedValue(jsonResponse(learningTask, 202))
    await tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'stable-key', 'FIXED', options)
    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1].headers).get('Idempotency-Key')).toBe('stable-key')
      expect(JSON.parse(call[1].body)).toEqual({
        taskType: 'QUIZ_GENERATION',
        remarks: '主题',
        scope: self,
        documentIds: [101],
        strategy: 'FIXED',
        ...options,
      })
    }
  })
  it('validates explicit options and rejects mixed task fields before sending', () => {
    const fetcher = setup()
    expect(() =>
      tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'key', 'FIXED', {
        quizOptions: { questionCount: 513, questionTypes: ['SINGLE_CHOICE'], difficulty: 'EASY' },
      }),
    ).toThrow()
    expect(() =>
      tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'key', 'FIXED', {
        quizOptions: {
          questionCount: 2,
          questionTypes: ['SINGLE_CHOICE', 'SINGLE_CHOICE'],
          difficulty: 'EASY',
        },
      }),
    ).toThrow()
    expect(() =>
      tasksApi.create('QUIZ_GENERATION', '主题', self, [101], 'key', 'FIXED', {
        compilationOptions: { detailLevel: 'DETAILED', maximumChapters: 6 },
      }),
    ).toThrow('混传')
    expect(() =>
      tasksApi.create('KNOWLEDGE_COMPILATION', '主题', self, [101], 'key', 'FIXED', {
        compilationOptions: { detailLevel: 'DETAILED', maximumChapters: 513 },
      }),
    ).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('accepts six-stage progress and safe private results for both workflows', async () => {
    expect(taskSchema.parse(learningTask).progress?.totalSteps).toBe(6)
    expect(learningResultSchema.parse(compilationResult).chapters[0]?.sections[0]?.groupId).toBe(
      'g1',
    )
    expect(
      learningResultSchema.safeParse({
        ...quizResult,
        citations: [
          {
            ...quizResult.citations[0],
            source: { ...quizResult.citations[0]!.source, documentId: 1e20 },
          },
        ],
      }).success,
    ).toBe(false)
    const fetcher = setup(jsonResponse(quizResult))
    expect(await tasksApi.result(51)).toEqual(quizResult)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/tasks/51/result')
    expect(fetcher.mock.calls[0]?.[1].cache).toBe('no-store')
  })
  it('keeps retired workflow errors and unpublished results without automatic retries', async () => {
    expect(isRetiredTask('FAQ')).toBe(true)
    const fetcher = setup(
      jsonResponse(
        { code: 'WORKFLOW_RESULT_UNAVAILABLE', message: '尚未发布', retryable: false },
        409,
      ),
    )
    await expect(tasksApi.result(51)).rejects.toMatchObject({
      status: 409,
      code: 'WORKFLOW_RESULT_UNAVAILABLE',
    })
    expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockResolvedValue(
      jsonResponse({ code: 'WORKFLOW_RETIRED', message: '已停用', retryable: false }, 410),
    )
    await expect(tasksApi.action(51, 'resume')).rejects.toMatchObject({
      status: 410,
      code: 'WORKFLOW_RETIRED',
      retryable: false,
    })
  })
})
