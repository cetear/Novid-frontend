import { http } from '@/shared/api/transport'
import { taskSchema, planSchema, type ScopeRequest } from '@/shared/api/contracts/backend'
import { positiveId, requiredText } from '@/shared/lib/validation'
import type { TaskType, PresentationOptions, VideoOptions } from '@/shared/api/contracts/media'
export const tasksApi = {
  create(
    taskType: TaskType,
    topic: string,
    scope: ScopeRequest,
    documentIds: number[],
    key: string,
    strategy?: 'FIXED' | 'PLANNED',
    media?: { presentationOptions?: PresentationOptions; videoOptions?: VideoOptions },
  ) {
    requiredText(topic, 1000, '主题')
    if (strategy === 'PLANNED' && taskType === 'FAQ') throw new Error('规划策略仅用于研究报告')
    if (taskType === 'NOTES_PPT' || taskType === 'NOTES_VIDEO') {
      if (strategy !== 'PLANNED') throw new Error('媒体任务须使用规划策略')
      const options = taskType === 'NOTES_PPT' ? media?.presentationOptions : media?.videoOptions
      if (
        !options ||
        !/^\d+(\.\d{1,8})?$/.test(options.maximumAmount) ||
        Number(options.maximumAmount) <= 0 ||
        Number(options.maximumAmount) > 30
      )
        throw new Error('请填写有效金额上限')
      if (taskType === 'NOTES_PPT') {
        const ppt = media?.presentationOptions
        if (!ppt || !Number.isInteger(ppt.pageCount) || ppt.pageCount < 2 || ppt.pageCount > 12)
          throw new Error('PPT 总页数须为 2～12 页（包含来源页）')
      } else {
        const video = media?.videoOptions
        if (
          !video ||
          !video.characterId ||
          !video.voiceId ||
          !video.sceneId ||
          !Number.isInteger(video.shotCount) ||
          video.shotCount < 1 ||
          video.shotCount > 6 ||
          !Number.isInteger(video.seconds) ||
          video.seconds < 1 ||
          video.seconds > 90
        )
          throw new Error('请核对人物、声音、场景、镜头数与时长')
      }
    }
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
        ...(taskType === 'NOTES_PPT' ? { presentationOptions: media?.presentationOptions } : {}),
        ...(taskType === 'NOTES_VIDEO' ? { videoOptions: media?.videoOptions } : {}),
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
