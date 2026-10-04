import { describe, it, expect, vi } from 'vitest'
import { effectScope } from 'vue'
import { processingOutcome } from '@/features/knowledge/model'
import { usePoll } from '@/shared/lib/usePoll'
import { document as snapshot } from '../fixtures'
describe('processing observation remains a projection of backend facts', () => {
  it('keeps observing old READY instead of declaring reprocess complete', () => {
    expect(processingOutcome({ version: 1, revision: 1 }, snapshot)).toBe('waiting')
  })
  it('confirms activation only after the same content version revision increases', () => {
    expect(
      processingOutcome({ version: 1, revision: 1 }, { ...snapshot, activeProcessingRevision: 2 }),
    ).toBe('activated')
  })
  it('does not declare index activation when the content version changed', () => {
    expect(
      processingOutcome(
        { version: 1, revision: 1 },
        {
          ...snapshot,
          documentVersion: 2,
          ingestionStatus: 'RECEIVED',
          activeProcessingRevision: null,
        },
      ),
    ).toBe('changed')
  })
  it('does not infer the outcome of a newer processing batch from FAILED or old READY', () => {
    expect(
      processingOutcome({ version: 1, revision: 1 }, { ...snapshot, ingestionStatus: 'FAILED' }),
    ).toBe('waiting')
  })
  it('does not restart a disposed observer after a late action response', () => {
    const scope = effectScope(),
      query = vi.fn().mockResolvedValue(true)
    const poll = scope.run(() => usePoll(query, vi.fn()))!
    scope.stop()
    poll.start()
    expect(query).not.toHaveBeenCalled()
    expect(poll.observing.value).toBe(false)
  })
})
