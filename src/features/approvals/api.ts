import { http } from '@/shared/api/transport'
import { approvalSchema } from '@/shared/api/contracts/backend'
export const approvalsApi = {
  get(id: string) {
    return http().json(`/approvals/${encodeURIComponent(id)}`, approvalSchema)
  },
  decide(id: string, approved: boolean) {
    return http().json(`/approvals/${encodeURIComponent(id)}/decision`, approvalSchema, {
      method: 'POST',
      json: { approved },
    })
  },
}
