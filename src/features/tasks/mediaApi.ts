import { z } from 'zod'
import { http } from '@/shared/api/transport'
import { positiveId, requiredText } from '@/shared/lib/validation'
import {
  previewSchema,
  capabilitySchema,
  catalogSchema,
  operationSchema,
  mediaPlanSchema,
  videoProgressSchema,
  presentationSchema,
  type MediaUnit,
  type VideoRecommendation,
} from '@/shared/api/contracts/media'
export const PPT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const mediaApi = {
  catalogs(signal?: AbortSignal) {
    return http().json('/media/catalogs', z.array(catalogSchema), { signal })
  },
  capabilities(signal?: AbortSignal) {
    return http().json('/media/video-capabilities', z.array(capabilitySchema), { signal })
  },
  preview(id: number, signal?: AbortSignal) {
    return http().optionalJson(`/tasks/${positiveId(id)}/preview`, previewSchema, { signal })
  },
  edit(id: number, previewVersion: number, units: MediaUnit[], signal?: AbortSignal) {
    if (units.length < 1 || units.length > 512) throw new Error('预览内容单元须为 1～512 个')
    return http().json(`/tasks/${positiveId(id)}/preview`, previewSchema, {
      method: 'PATCH',
      json: { previewVersion, units },
      signal,
    })
  },
  selection(
    id: number,
    previewVersion: number,
    shots: VideoRecommendation[],
    signal?: AbortSignal,
  ) {
    if (new Set(shots.map((s) => s.profileId)).size !== 1)
      throw new Error('整部视频必须使用同一 API')
    return http().json(`/tasks/${positiveId(id)}/video-selection`, previewSchema, {
      method: 'PATCH',
      json: { previewVersion, shots },
      signal,
    })
  },
  decide(approvalId: string, taskId: number, approved: boolean, signal?: AbortSignal) {
    return http().json(
      `/media/approvals/${encodeURIComponent(approvalId)}/decision`,
      previewSchema,
      { method: 'POST', json: { approved, taskId: positiveId(taskId) }, signal },
    )
  },
  operations(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}/media-operations`, z.array(operationSchema), {
      signal,
    })
  },
  plans(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}/media-plans`, z.array(mediaPlanSchema), { signal })
  },
  progress(id: number, signal?: AbortSignal) {
    return http().json(`/tasks/${positiveId(id)}/media-progress`, videoProgressSchema, { signal })
  },
  presentation(id: number, signal?: AbortSignal) {
    return http().optionalJson(`/tasks/${positiveId(id)}/presentation-check`, presentationSchema, {
      signal,
    })
  },
  exportPresentation(id: number, previewVersion: number, signal?: AbortSignal) {
    return http().empty(`/tasks/${positiveId(id)}/presentation-export`, {
      method: 'POST',
      json: { previewVersion },
      signal,
    })
  },
  review(
    id: number,
    previewVersion: number,
    accepted: boolean,
    note: string,
    signal?: AbortSignal,
  ) {
    requiredText(note, 2000, '验收说明')
    return http().empty(`/tasks/${positiveId(id)}/media-review`, {
      method: 'POST',
      json: { previewVersion, accepted, note },
      signal,
    })
  },
  artifact(id: number, mime: string, signal?: AbortSignal) {
    if (![PPT_MIME, 'image/png', 'image/jpeg', 'video/mp4', 'application/x-subrip'].includes(mime))
      throw new Error('不支持的媒体附件类型')
    return http().binary(`/artifacts/${positiveId(id)}`, [mime], { signal })
  },
}
