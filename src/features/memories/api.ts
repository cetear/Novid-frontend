import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { memorySchema, type MemorySnapshot } from '@/shared/api/contracts/backend'
import { positiveId, requiredText } from '@/shared/lib/validation'
export const memoriesApi = {
  list() {
    return http().json('/memories', z.array(memorySchema))
  },
  create(content: string) {
    requiredText(content, 2000, '偏好')
    return http().json('/memories', memorySchema, { method: 'POST', json: { content } })
  },
  update(memory: MemorySnapshot, content: string) {
    requiredText(content, 2000, '偏好')
    return http().json(`/memories/${positiveId(memory.id)}`, memorySchema, {
      method: 'PATCH',
      json: { version: memory.version, content },
    })
  },
  delete(memory: MemorySnapshot) {
    return http().empty(`/memories/${positiveId(memory.id)}?version=${memory.version}`, {
      method: 'DELETE',
    })
  },
}
