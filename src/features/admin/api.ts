import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { userSchema, createdUserSchema, type Role } from '@/shared/api/contracts/backend'
import { positiveId, validUsername } from '@/shared/lib/validation'
export const adminApi = {
  list(page: number) {
    return http().json(`/admin/users?page=${page}&size=20`, z.array(userSchema))
  },
  create(username: string) {
    validUsername(username)
    return http().json('/admin/users', createdUserSchema, { method: 'POST', json: { username } })
  },
  update(id: number, enabled: boolean, role: Role) {
    return http().json(`/admin/users/${positiveId(id)}`, userSchema, {
      method: 'PATCH',
      json: { enabled, role },
    })
  },
}
