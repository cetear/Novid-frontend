import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { traceSchema, graphSchema, spanSchema } from '@/shared/api/contracts/backend'
import { callDetailSchema, payloadPageSchema } from '@/shared/api/contracts/modelCalls'
const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`
const callPath = (id: string, call: string) => `${runPath(id)}/calls/${encodeURIComponent(call)}`
export const runsApi = {
  list(page: number) {
    return http().json(`/runs?page=${page}&size=20`, z.array(traceSchema))
  },
  get(id: string, signal?: AbortSignal) {
    return http().json(`/runs/${encodeURIComponent(id)}`, traceSchema, { signal })
  },
  graph(id: string, signal?: AbortSignal) {
    return http().json(`${runPath(id)}/graph?view=summary`, graphSchema, { signal })
  },
  node(id: string, node: string, signal?: AbortSignal) {
    return http().json(`${runPath(id)}/nodes/${encodeURIComponent(node)}`, spanSchema, { signal })
  },
  calls(id: string, page = 0, nodeId?: string, signal?: AbortSignal) {
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('页码无效')
    const query = new URLSearchParams({ page: String(page), size: '20' })
    if (nodeId) query.set('nodeId', nodeId)
    return http().json(`${runPath(id)}/calls?${query}`, z.array(callDetailSchema), { signal })
  },
  call(id: string, call: string, signal?: AbortSignal) {
    return http().json(callPath(id, call), callDetailSchema, { signal })
  },
  payload(
    id: string,
    call: string,
    side: 'INPUT' | 'OUTPUT',
    view: 'raw' | 'model',
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({ limit: '8192', view })
    if (cursor !== undefined) query.set('cursor', cursor)
    return http().json(`${callPath(id, call)}/payloads/${side}?${query}`, payloadPageSchema, {
      signal,
    })
  },
  download(id: string, call: string, side: 'INPUT' | 'OUTPUT', signal?: AbortSignal) {
    return http().binary(`${callPath(id, call)}/payloads/${side}/download`, ['text/plain'], {
      signal,
    })
  },
}
