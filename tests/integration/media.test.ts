import { describe, it, expect, vi } from 'vitest'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { feeSchema, previewSchema, presentationSchema } from '@/shared/api/contracts/media'
import { mediaApi, PPT_MIME } from '@/features/tasks/mediaApi'
import { tasksApi } from '@/features/tasks/api'
import { fee, mediaPreview, presentation } from '../mediaFixtures'
import { jsonResponse, task } from '../fixtures'
function setup(response: Response) {
  const fetcher = vi.fn().mockResolvedValue(response)
  const api = createTransport({
    base: '/api/v1',
    identity: () => ({ token: 'opaque', epoch: 1 }),
    onUnauthorized: vi.fn(),
    onPasswordRequired: vi.fn(),
    fetch: fetcher,
  })
  configureTransport(api)
  return { api, fetcher }
}
describe('S07–S10 private media contracts', () => {
  it('keeps decimal subtotals separate and rejects unsafe usage counts', () => {
    expect(feeSchema.parse(fee).estimatedAmount).toBe('0.12500001')
    expect(feeSchema.safeParse({ ...fee, attempts: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
      false,
    )
    expect(previewSchema.parse(mediaPreview).previewVersion).toBe(1)
    expect(
      previewSchema.parse({ ...mediaPreview, estimatedAmount: null }).estimatedAmount,
    ).toBeNull()
    expect(
      feeSchema.parse({
        ...fee,
        currency: null,
        limitAmount: null,
        costStatus: 'NO_RECORDED_ATTEMPTS',
      }).limitAmount,
    ).toBeNull()
    expect(presentationSchema.parse(presentation).check.qualityStatus).toBe('REQUIRES_HUMAN_REVIEW')
  })
  it('creates typed PPT options with the original idempotency key and no video fields', async () => {
    const { fetcher } = setup(jsonResponse({ ...task, taskType: 'NOTES_PPT' }, 202))
    await tasksApi.create(
      'NOTES_PPT',
      '水循环',
      { mode: 'SELF', knowledgeBaseIds: [], ownerUserId: null },
      [101],
      'original-key',
      'PLANNED',
      {
        presentationOptions: {
          pageCount: 6,
          themeId: 'default',
          maximumAmount: '20',
          imagePolicy: 'MIXED',
        },
      },
    )
    const options = fetcher.mock.calls[0]?.[1]
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('original-key')
    expect(JSON.parse(options.body)).toMatchObject({
      presentationOptions: { pageCount: 6 },
      strategy: 'PLANNED',
    })
    expect(JSON.parse(options.body)).not.toHaveProperty('videoOptions')
  })
  it('distinguishes not-ready preview 204 from a binary file', async () => {
    setup(new Response(null, { status: 204 }))
    expect(await mediaApi.preview(51)).toBeNull()
    const { api, fetcher } = setup(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: {
          'content-type': PPT_MIME,
          'x-artifact-revision': '2',
          'x-artifact-checksum': 'hash',
        },
      }),
    )
    const result = await api.binary('/artifacts/91', [PPT_MIME])
    expect(result.blob.size).toBe(4)
    expect(result.revision).toBe('2')
    expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get('Authorization')).toBe(
      'Bearer opaque',
    )
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/artifacts/91')
  })
  it('rejects a proxy HTML response instead of downloading a false PPTX', async () => {
    const { api } = setup(
      new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }),
    )
    await expect(api.binary('/artifacts/91', [PPT_MIME])).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })
  it('stops mixed API selection before any external request and keeps review distinct from approval', async () => {
    const { fetcher } = setup(new Response(null, { status: 204 }))
    expect(() =>
      mediaApi.selection(51, 1, [
        {
          shotId: 's1',
          profileId: 'a',
          resolution: '720p',
          audioMode: 'NATIVE',
          seconds: 5,
          reason: 'a',
        },
        {
          shotId: 's2',
          profileId: 'b',
          resolution: '720p',
          audioMode: 'NATIVE',
          seconds: 5,
          reason: 'b',
        },
      ]),
    ).toThrow('同一 API')
    expect(fetcher).not.toHaveBeenCalled()
    await mediaApi.review(51, 1, false, '第二页图文不匹配')
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/tasks/51/media-review')
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
      previewVersion: 1,
      accepted: false,
      note: '第二页图文不匹配',
    })
  })
})
