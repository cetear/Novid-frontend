import { http } from '@/shared/api/transport'
import { taskSchema, type ScopeRequest } from '@/shared/api/contracts/backend'
import { contentPlanSchema } from '@/shared/api/contracts/contentPlan'
import { positiveId, requiredText } from '@/shared/lib/validation'
import type { TaskType, PresentationOptions, VideoOptions } from '@/shared/api/contracts/media'
import {
  learningResultSchema,
  quizOptionsSchema,
  compilationOptionsSchema,
  type QuizOptions,
  type CompilationOptions,
} from '@/shared/api/contracts/learning'
export const tasksApi = {
  create(
    taskType: TaskType,
    instructions: string,
    scope: ScopeRequest,
    documentIds: number[],
    key: string,
    strategy?: 'FIXED' | 'PLANNED',
    options?: {
      presentationOptions?: PresentationOptions
      videoOptions?: VideoOptions
      quizOptions?: QuizOptions
      compilationOptions?: CompilationOptions
    },
  ) {
    const instructionsText = instructions.trim()
    if (taskType === 'NOTES_VIDEO') requiredText(instructionsText, 1000, '主题')
    else if (instructionsText.length > 1000) throw new Error('备注不能超过 1000 字符')
    if (
      !['QUIZ_GENERATION', 'KNOWLEDGE_COMPILATION', 'NOTES_PPT', 'NOTES_VIDEO'].includes(taskType)
    )
      throw new Error('WORKFLOW_RETIRED：旧 FAQ／研究报告已停用，请选择学习自测或资料整编')
    if (taskType !== 'NOTES_VIDEO' && strategy === 'PLANNED')
      throw new Error('资料任务使用固定流程')
    const allowedOption = {
      QUIZ_GENERATION: 'quizOptions',
      KNOWLEDGE_COMPILATION: 'compilationOptions',
      NOTES_PPT: 'presentationOptions',
      NOTES_VIDEO: 'videoOptions',
    }[taskType]
    if (Object.keys(options ?? {}).some((key) => key !== allowedOption))
      throw new Error('不能混传其他任务类型的选项')
    const quiz =
      options?.quizOptions === undefined ? undefined : quizOptionsSchema.parse(options.quizOptions)
    const compilation =
      options?.compilationOptions === undefined
        ? undefined
        : compilationOptionsSchema.parse(options.compilationOptions)
    if (taskType === 'NOTES_PPT' || taskType === 'NOTES_VIDEO') {
      if (taskType === 'NOTES_VIDEO' && strategy === 'FIXED')
        throw new Error('视频任务须使用规划策略')
      const mediaOptions =
        taskType === 'NOTES_PPT' ? options?.presentationOptions : options?.videoOptions
      if (
        (taskType === 'NOTES_VIDEO' && !mediaOptions) ||
        (mediaOptions &&
          (!/^\d+(\.\d{1,8})?$/.test(mediaOptions.maximumAmount) ||
            Number(mediaOptions.maximumAmount) <= 0 ||
            Number(mediaOptions.maximumAmount) > 30))
      )
        throw new Error('请填写有效金额上限')
      if (taskType === 'NOTES_PPT') {
        const ppt = options?.presentationOptions
        if (
          ppt &&
          ppt.pageCount !== undefined &&
          (!Number.isInteger(ppt.pageCount) ||
            ppt.pageCount === 1 ||
            ppt.pageCount < 0 ||
            ppt.pageCount > 512)
        )
          throw new Error('PPT 总页数须为 0（自动）或 2～512 页（包含来源页）')
        if (
          ppt &&
          (ppt.themeId !== 'default' || !['MIXED', 'CONCEPT', 'FACTUAL'].includes(ppt.imagePolicy))
        )
          throw new Error('请核对主题与配图策略')
      } else {
        const video = options?.videoOptions
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
        ...(taskType === 'NOTES_VIDEO'
          ? { topic: instructionsText }
          : instructionsText
            ? { remarks: instructionsText }
            : {}),
        scope,
        documentIds: documentIds.map(positiveId),
        ...(strategy ? { strategy } : {}),
        ...(quiz ? { quizOptions: quiz } : {}),
        ...(compilation ? { compilationOptions: compilation } : {}),
        ...(taskType === 'NOTES_PPT' && options?.presentationOptions
          ? {
              presentationOptions: {
                pageCount: options!.presentationOptions!.pageCount,
                themeId: options!.presentationOptions!.themeId,
                maximumAmount: Number(options!.presentationOptions!.maximumAmount),
                imagePolicy: options!.presentationOptions!.imagePolicy,
              },
            }
          : {}),
        ...(taskType === 'NOTES_VIDEO'
          ? {
              videoOptions: {
                characterId: options!.videoOptions!.characterId,
                voiceId: options!.videoOptions!.voiceId,
                sceneId: options!.videoOptions!.sceneId,
                seconds: options!.videoOptions!.seconds,
                maximumAmount: Number(options!.videoOptions!.maximumAmount),
                shotCount: options!.videoOptions!.shotCount,
                burnSubtitles: options!.videoOptions!.burnSubtitles,
              },
            }
          : {}),
      },
    })
  },
  get(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}`, taskSchema, { signal })
  },
  contentPlan(id: number, signal?: AbortSignal) {
    return http().optionalJson(`/tasks/${positiveId(id)}/content-plan`, contentPlanSchema, {
      signal,
    })
  },
  result(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}/result`, learningResultSchema, { signal })
  },
  action(id: number, action: 'pause' | 'resume' | 'cancel', signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}/actions`, taskSchema, {
      method: 'POST',
      json: { action },
      signal,
    })
  },
  artifact(id: number, signal?: AbortSignal) {
    return http().text(`/artifacts/${positiveId(id)}`, 'text/markdown', { signal })
  },
}
