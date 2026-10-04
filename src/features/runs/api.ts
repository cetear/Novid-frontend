import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { traceSchema, graphSchema } from '@/shared/api/contracts/backend'
export const runsApi = {
  list(page: number) {
    return http().json(`/runs?page=${page}&size=20`, z.array(traceSchema))
  },
  get(id: string, signal?: AbortSignal) {
    return http().json(`/runs/${encodeURIComponent(id)}`, traceSchema, { signal })
  },
  graph(id: string, signal?: AbortSignal) {
    return http().json(`/runs/${encodeURIComponent(id)}/graph`, graphSchema, { signal })
  },
}
