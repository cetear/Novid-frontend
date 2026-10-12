import { describe, it, expect, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { tasksApi } from '@/features/tasks/api'
import { retryPlanSchema, retryRequestSchema } from '@/shared/api/contracts/taskRetry'
import { retryPlan, retryRequest } from '../retryFixtures'
import { jsonResponse, task } from '../fixtures'
describe('manual compilation continuation', () => {
  it('preserves negative balances and rejects invalid additions or unsupported modes', () => {
    expect(retryPlanSchema.parse(retryPlan).remainingExecutionSeconds).toBe(-10)
    for (const change of [
      { mode: 'REVIEW' },
      { additionalTokens: 10000001 },
      { additionalAmount: 0.000000001 },
      { expectedStateVersion: 0 },
      { additionalAttempts: -1 },
    ]) {
      expect(retryRequestSchema.safeParse({ ...retryRequest, ...change }).success).toBe(false)
    }
  })
  it('reads without caching and sends exact version and additions with stable supplied keys', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(retryPlan))
      .mockImplementation(async () => jsonResponse({ ...task, taskType: 'KNOWLEDGE_COMPILATION' }))
    configureTransport(
      createTransport({
        base: '/api/v1',
        identity: () => ({ token: 'test', epoch: 1 }),
        onUnauthorized: vi.fn(),
        onPasswordRequired: vi.fn(),
        fetch: fetcher,
      }),
    )
    await tasksApi.retryPlan(51)
    expect(fetcher.mock.calls[0]![1].cache).toBe('no-store')
    await tasksApi.retry(51, retryRequest, 'stable-retry')
    await tasksApi.retry(51, retryRequest, 'stable-retry')
    expect(fetcher.mock.calls[1]![0]).toBe('/api/v1/tasks/51/retry')
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(retryRequest)
    expect(new Headers(fetcher.mock.calls[2]![1].headers).get('Idempotency-Key')).toBe(
      'stable-retry',
    )
  })
})
