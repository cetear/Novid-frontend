import { http } from '@/shared/api/transport'
import { taskSchema, planSchema, type ScopeRequest } from '@/shared/api/contracts/backend'
import { positiveId, requiredText } from '@/shared/lib/validation'
export const tasksApi = {
  create(
    taskType: 'FAQ' | 'RESEARCH_REPORT',
    topic: string,
    scope: ScopeRequest,
    documentIds: number[],
    key: string,
    strategy?: 'FIXED' | 'PLANNED',
  ) {
    requiredText(topic, 1000, '主题')
    if (strategy === 'PLANNED' && taskType !== 'RESEARCH_REPORT')
      throw new Error('规划策略仅用于研究报告')
    if (documentIds.length < 1 || documentIds.length > 6) throw new Error('请选择 1～6 个文档')
    if (scope.mode === 'SELECTED' && !scope.knowledgeBaseIds.length)
      throw new Error('请先选择知识库范围')
    return http().json('/tasks', taskSchema, {
      method: 'POST',
      key,
      json: {
        taskType,
        topic,
        scope,
        documentIds: documentIds.map(positiveId),
        ...(strategy ? { strategy } : {}),
      },
    })
  },
  get(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}`, taskSchema, { signal })
  },
  plan(id: number, signal?: AbortSignal) {
    return http().optionalJson(`/tasks/${positiveId(id)}/plan`, planSchema, { signal })
  },
  action(id: number, action: 'pause' | 'resume' | 'cancel') {
    return http().json(`/tasks/${positiveId(id)}/actions`, taskSchema, {
      method: 'POST',
      json: { action },
    })
  },
  artifact(id: number) {
    return http().text(`/artifacts/${positiveId(id)}`, 'text/markdown')
  },
}
