import { z } from 'zod'
import { http } from '@/shared/api/transport'
import {
  baseSchema,
  documentSchema,
  contentSchema,
  statisticsSchema,
  sectionSchema,
  chunkSchema,
  sectionPageSchema,
  ingestionSchema,
  type ScopeRequest,
  type KnowledgeBaseSnapshot,
  type DocumentContent,
} from '@/shared/api/contracts/backend'
import { positiveId, requiredText, validBody, validFile } from '@/shared/lib/validation'

export function scopeQuery(scope: ScopeRequest, page = 0, size = 20, statistics = false) {
  const query = new URLSearchParams({ scopeMode: scope.mode })
  if (scope.mode === 'SELECTED')
    query.set('knowledgeBaseIds', scope.knowledgeBaseIds.map(positiveId).join(','))
  if (!statistics && scope.ownerUserId !== null)
    query.set('ownerUserId', String(positiveId(scope.ownerUserId)))
  if (!statistics) {
    query.set('page', String(page))
    query.set('size', String(size))
  }
  return query.toString()
}
export const knowledgeApi = {
  bases(scope: ScopeRequest, page = 0, signal?: AbortSignal) {
    return http().json(`/knowledge-bases?${scopeQuery(scope, page)}`, z.array(baseSchema), {
      signal,
    })
  },
  base(id: number) {
    return http().json(`/knowledge-bases/${positiveId(id)}`, baseSchema)
  },
  createBase(name: string, description: string) {
    requiredText(name, 200, '名称')
    if (description.length > 2000) throw new Error('描述最多 2000 字符')
    return http().json('/knowledge-bases', baseSchema, {
      method: 'POST',
      json: { name, description },
    })
  },
  updateBase(base: KnowledgeBaseSnapshot, name: string, description: string, enabled: boolean) {
    requiredText(name, 200, '名称')
    if (description.length > 2000) throw new Error('描述最多 2000 字符')
    return http().json(`/knowledge-bases/${positiveId(base.id)}`, baseSchema, {
      method: 'PATCH',
      json: { version: base.version, name, description, enabled },
    })
  },
  deleteBase(base: KnowledgeBaseSnapshot) {
    return http().empty(`/knowledge-bases/${positiveId(base.id)}?version=${base.version}`, {
      method: 'DELETE',
    })
  },
  documents(scope: ScopeRequest, page = 0, signal?: AbortSignal) {
    return http().json(`/documents?${scopeQuery(scope, page)}`, z.array(documentSchema), { signal })
  },
  document(id: number, signal?: AbortSignal) {
    return http().json(`/documents/${positiveId(id)}`, contentSchema, { signal })
  },
  statistics(scope: ScopeRequest, signal?: AbortSignal) {
    return http().json(
      `/knowledge/statistics?${scopeQuery(scope, 0, 20, true)}`,
      statisticsSchema,
      { signal },
    )
  },
  async upload(file: File, knowledgeBaseId: number, key: string) {
    await validFile(file)
    const form = new FormData()
    form.set('knowledgeBaseId', String(positiveId(knowledgeBaseId)))
    const allowed = ['text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream']
    const data = allowed.includes(file.type.toLowerCase())
      ? file
      : new Blob([file], {
          type: /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : 'text/plain',
        })
    form.set('file', data, file.name)
    return http().json('/documents', documentSchema, { method: 'POST', body: form, key })
  },
  updateDocument(content: DocumentContent, title: string, text: string) {
    requiredText(title, 200, '标题')
    validBody(text)
    return http().json(`/documents/${positiveId(content.document.id)}`, documentSchema, {
      method: 'PATCH',
      json: { documentVersion: content.document.documentVersion, title, text },
    })
  },
  deleteDocument(id: number, documentVersion: number) {
    return http().empty(
      `/documents/${positiveId(id)}?documentVersion=${positiveId(documentVersion)}`,
      { method: 'DELETE' },
    )
  },
  index(id: number, action: 'retry' | 'reprocess') {
    return http().empty(`/documents/${positiveId(id)}/index-actions?action=${action}`, {
      method: 'POST',
    })
  },
  ingestion(id: number, signal?: AbortSignal) {
    return http().json(`/documents/${positiveId(id)}/ingestion`, ingestionSchema, { signal })
  },
  recover(id: number, processingRevision: number) {
    return http().empty(
      `/documents/${positiveId(id)}/index-actions?action=recover&processingRevision=${positiveId(processingRevision)}`,
      { method: 'POST' },
    )
  },
  section(
    id: number,
    sectionId: string,
    documentVersion: number,
    processingRevision: number,
    afterOffset?: number,
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams({
      documentVersion: String(positiveId(documentVersion)),
      processingRevision: String(positiveId(processingRevision)),
      maxTokens: '4000',
    })
    if (afterOffset !== undefined) {
      if (!Number.isSafeInteger(afterOffset) || afterOffset < 0) throw new Error('章节游标无效')
      query.set('afterOffset', String(afterOffset))
    }
    return http().json(
      `/documents/${positiveId(id)}/sections/${encodeURIComponent(sectionId)}?${query}`,
      sectionPageSchema,
      { signal },
    )
  },
  sections(id: number, page: number) {
    return http().json(
      `/documents/${positiveId(id)}/sections?page=${page}&size=20`,
      z.array(sectionSchema),
    )
  },
  chunks(id: number, page: number) {
    return http().json(
      `/documents/${positiveId(id)}/chunks?page=${page}&size=20`,
      z.array(chunkSchema),
    )
  },
  source(id: number) {
    return http().text(`/documents/${positiveId(id)}/source`, 'text/plain')
  },
}
