import type { EventSourceMessage } from 'eventsource-parser'
import { z } from 'zod'
import {
  aiSchema,
  evidenceSchema,
  type AiResult,
  type EvidenceBundle,
} from '@/shared/api/contracts/backend'
import { ApiError } from '@/shared/api/errors'
export function createChatReducer(
  onChange: (text: string, citations: EvidenceBundle[], stage: string) => void,
) {
  let text = '',
    citations: EvidenceBundle[] = [],
    result: AiResult | null = null,
    phase = 'initial'
  const seen = new Map<string, string>()
  const fail = () => {
    throw new ApiError('流式事件顺序或内容异常，结果需核对', 0, 'SSE_PROTOCOL_ERROR')
  }
  return {
    event(event: EventSourceMessage) {
      if (event.id) {
        const signature = `${event.event}:${event.data}`
        if (seen.has(event.id)) {
          if (seen.get(event.id) !== signature) fail()
          return
        }
        if (seen.size > 20_000) fail()
        seen.set(event.id, signature)
      }
      const name = event.event
      if (!['progress', 'delta', 'citation', 'done', 'error'].includes(name || '')) return
      if (phase === 'done') fail()
      let payload: unknown
      try {
        payload = JSON.parse(event.data)
      } catch {
        return fail()
      }
      if (name === 'error') {
        const e = z
          .object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() })
          .safeParse(payload)
        if (!e.success) return fail()
        throw new ApiError(
          e.data.message.slice(0, 500),
          200,
          e.data.code,
          e.data.retryable === true,
        )
      }
      if (name === 'progress') {
        const progress = z.object({ stage: z.enum(['processing', 'validated']) }).safeParse(payload)
        if (!progress.success || !['initial', 'processing'].includes(phase)) return fail()
        phase = progress.data.stage
      } else if (name === 'delta') {
        if (!['validated', 'delta'].includes(phase)) return fail()
        const delta = z.object({ text: z.string().max(512) }).safeParse(payload)
        if (!delta.success) return fail()
        text += delta.data.text
        phase = 'delta'
      } else if (name === 'citation') {
        if (!['validated', 'delta', 'citation'].includes(phase)) return fail()
        const citation = evidenceSchema.safeParse(payload)
        if (!citation.success) return fail()
        citations = [
          ...citations.filter((c) => c.evidenceId !== citation.data.evidenceId),
          citation.data,
        ]
        phase = 'citation'
      } else if (name === 'done') {
        if (phase === 'initial') return fail()
        const parsed = aiSchema.safeParse(payload)
        if (!parsed.success) return fail()
        result = parsed.data
        text = result.answer
        citations = result.citations
        phase = 'done'
      }
      onChange(
        text,
        citations,
        phase === 'done' ? '等待传输结束' : phase === 'processing' ? '正在处理' : '已完成后端校验',
      )
    },
    finish() {
      if (!result || phase !== 'done')
        throw new ApiError('传输未完整结束，结果需核对', 0, 'SSE_INCOMPLETE')
      return result
    },
  }
}
