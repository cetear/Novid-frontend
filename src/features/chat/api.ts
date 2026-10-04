import { http } from '@/shared/api/transport'
import {
  aiSchema,
  approvalSchema,
  type ScopeRequest,
  type SourceDependency,
  type EvidenceBundle,
  type ChatOptions,
} from '@/shared/api/contracts/backend'
import { readEventStream } from '@/shared/api/sse/readStream'
import { requiredText, positiveId, validBody } from '@/shared/lib/validation'
import { createChatReducer } from './reducer'
export function validateScope(scope: ScopeRequest) {
  if (
    scope.mode === 'SELECTED' &&
    (!scope.knowledgeBaseIds.length || scope.knowledgeBaseIds.length > 100)
  )
    throw new Error('请先选择 1～100 个知识库')
  scope.knowledgeBaseIds.forEach(positiveId)
}
export const chatApi = {
  ask(question: string, scope: ScopeRequest, signal: AbortSignal, options: ChatOptions = {}) {
    requiredText(question, 2000, '问题')
    validateScope(scope)
    return http().json('/chat', aiSchema, {
      method: 'POST',
      json: requestBody(question, scope, options),
      signal,
    })
  },
  stream(
    question: string,
    scope: ScopeRequest,
    signal: AbortSignal,
    onChange: (text: string, citations: EvidenceBundle[], stage: string) => void,
    options: ChatOptions = {},
  ) {
    requiredText(question, 2000, '问题')
    validateScope(scope)
    const reducer = createChatReducer(onChange)
    return http().stream(
      '/chat/stream',
      { method: 'POST', json: requestBody(question, scope, options), signal },
      async (response) => {
        await readEventStream(response, reducer.event)
        return reducer.finish()
      },
    )
  },
  prepare(
    knowledgeBaseId: number,
    title: string,
    content: string,
    sourceDependencies: SourceDependency[],
    signal?: AbortSignal,
  ) {
    requiredText(title, 200, '标题')
    validBody(content)
    if (!sourceDependencies.length || sourceDependencies.length > 32)
      throw new Error('笔记需要 1～32 项真实来源')
    return http().json('/notes/prepare', approvalSchema, {
      method: 'POST',
      signal,
      json: { knowledgeBaseId: positiveId(knowledgeBaseId), title, content, sourceDependencies },
    })
  },
}
function requestBody(question: string, scope: ScopeRequest, options: ChatOptions) {
  if ((options.sessionId === undefined) !== (options.sessionVersion === undefined))
    throw new Error('会话 ID 和版本必须同时提供')
  if (options.toolMode === 'READ_ONLY' && options.responseFormat === 'STRUCTURED')
    throw new Error('只读工具续轮仅支持文本回答')
  return {
    question,
    scope,
    ...(options.sessionId === undefined
      ? {}
      : {
          sessionId: positiveId(options.sessionId),
          sessionVersion: positiveId(options.sessionVersion),
        }),
    ...(options.modelProfile === undefined ? {} : { modelProfile: options.modelProfile }),
    ...(options.responseFormat === undefined ? {} : { responseFormat: options.responseFormat }),
    ...(options.toolMode === undefined ? {} : { toolMode: options.toolMode }),
  }
}
export function dependenciesFrom(citations: EvidenceBundle[]): SourceDependency[] {
  return [
    ...new Map(
      citations.map(({ document: d }) => [
        `${d.id}:${d.documentVersion}`,
        {
          knowledgeBaseId: d.knowledgeBaseId,
          documentId: d.id,
          documentVersion: d.documentVersion,
        },
      ]),
    ).values(),
  ]
}
