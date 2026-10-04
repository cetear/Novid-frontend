import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { sessionSchema, sessionMessageSchema, toolSchema } from '@/shared/api/contracts/backend'
import { positiveId, requiredText } from '@/shared/lib/validation'

export const sessionsApi = {
  create(title: string, key: string, signal?: AbortSignal) {
    requiredText(title, 200, '会话标题')
    return http().json('/sessions', sessionSchema, { method: 'POST', json: { title }, key, signal })
  },
  list(page = 0, signal?: AbortSignal) {
    return http().json(`/sessions?page=${page}&size=20`, z.array(sessionSchema), { signal })
  },
  get(id: number, signal?: AbortSignal) {
    return http().json(`/sessions/${positiveId(id)}`, sessionSchema, { signal })
  },
  messages(id: number, afterSeq = 0, signal?: AbortSignal) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('历史游标无效')
    return http().json(
      `/sessions/${positiveId(id)}/messages?afterSeq=${afterSeq}&size=20`,
      z.array(sessionMessageSchema),
      { signal },
    )
  },
  delete(id: number, version: number, signal?: AbortSignal) {
    return http().empty(`/sessions/${positiveId(id)}?version=${positiveId(version)}`, {
      method: 'DELETE',
      signal,
    })
  },
  tools(signal?: AbortSignal) {
    return http().json('/tools?taskType=KNOWLEDGE_QA', z.array(toolSchema), { signal })
  },
}
