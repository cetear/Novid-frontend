import { describe, expect, it, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { runsApi } from '@/features/runs/api'
import { payloadPageSchema, callDetailSchema } from '@/shared/api/contracts/modelCalls'
import { modelCall } from '../modelCallFixtures'
import { graph } from '../stageFixtures'
import { jsonResponse } from '../fixtures'
describe('private model call archive', () => {
  it('uses summary and encoded business filters, accepts Detail lists, and preserves opaque cursors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(graph))
      .mockResolvedValueOnce(jsonResponse([modelCall]))
      .mockResolvedValueOnce(
        jsonResponse({
          payload: modelCall.output,
          content: '下一页',
          nextCursor: null,
          contentKind: 'MODEL_TEXT',
        }),
      )
    configureTransport(
      createTransport({
        base: '/api/v1',
        identity: () => ({ token: 'test', epoch: 1 }),
        onUnauthorized: vi.fn(),
        onPasswordRequired: vi.fn(),
        fetch: fetcher,
      }),
    )
    await runsApi.graph('trace-1')
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/runs/trace-1/graph?view=summary')
    expect((await runsApi.calls('trace-1', 2, 'generate q/1'))[0]?.call.validationStatus).toBe(
      'FAILED',
    )
    expect(fetcher.mock.calls[1]![0]).toContain('nodeId=generate+q%2F1')
    await runsApi.payload('trace-1', 'call-1', 'OUTPUT', 'model', 'opaque+/=')
    expect(fetcher.mock.calls[2]![0]).toContain('cursor=opaque%2B%2F%3D')
    expect(fetcher.mock.calls[2]![1].cache).toBe('no-store')
    expect(() => runsApi.calls('trace-1', -1)).toThrow('页码')
  })
  it('keeps unavailable distinct from empty and validates bounded pages and diagnostic offsets', () => {
    const missing = callDetailSchema.parse({
      ...modelCall,
      input: { ...modelCall.input, state: 'NOT_CAPTURED', preview: null },
    })
    expect(missing.input.state).toBe('NOT_CAPTURED')
    expect(
      payloadPageSchema.safeParse({
        payload: modelCall.input,
        content: 'x'.repeat(16385),
        nextCursor: null,
        contentKind: 'RAW',
      }).success,
    ).toBe(false)
    expect(
      payloadPageSchema.parse({
        payload: modelCall.input,
        content: '',
        nextCursor: null,
        contentKind: 'RAW',
      }).content,
    ).toBe('')
    expect(callDetailSchema.parse(modelCall).call.diagnostic?.items[0]?.start).toBe(10)
  })
})
