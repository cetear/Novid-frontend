import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { feeSchema, feeAggregateSchema } from '@/shared/api/contracts/media'
import { positiveId } from '@/shared/lib/validation'
export type FeeKind = 'runs' | 'tasks' | 'ingestions'
export const feesApi = {
  get(kind: FeeKind, resourceId: string | number, signal?: AbortSignal) {
    const resource =
      kind === 'runs' ? encodeURIComponent(String(resourceId)) : positiveId(resourceId)
    return http().json(`/${kind}/${resource}/fees`, feeSchema, { signal })
  },
  aggregate(days: number, signal?: AbortSignal) {
    return http().json(`/admin/fees?days=${days}`, z.array(feeAggregateSchema), { signal })
  },
}
