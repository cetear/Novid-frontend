import type {
  AiResult,
  ApprovalSnapshot,
  DocumentSnapshot,
  KnowledgeBaseSnapshot,
  TaskSnapshot,
  UserSnapshot,
} from '@/shared/api/contracts/backend'
export const user: UserSnapshot = {
  id: 7,
  username: 'learner',
  role: 'USER',
  enabled: true,
  permissionVersion: 1,
  passwordChangeRequired: false,
}
export const base: KnowledgeBaseSnapshot = {
  id: 12,
  ownerUserId: 7,
  name: '学习资料',
  description: '开发与验证',
  enabled: true,
  deleted: false,
  version: 1,
}
export const document: DocumentSnapshot = {
  id: 101,
  knowledgeBaseId: 12,
  ownerUserId: 7,
  title: '验证指南',
  format: 'md',
  documentVersion: 1,
  ingestionStatus: 'READY',
  activeProcessingRevision: 1,
}
export const evidence = {
  evidenceId: 'E1',
  document,
  processingRevision: 1,
  sectionId: 's1',
  headingPath: '步骤',
  matchedChunkIds: ['c1'],
  includedChunkIds: ['c1', 'c2'],
  startOffset: 0,
  endOffset: 5,
  text: '知识与验证',
}
export const ai: AiResult = {
  status: 'SUCCESS',
  answer: '根据资料，先验证契约。[E1]',
  citations: [evidence],
  traceId: 'trace-1',
  modelId: 'primary',
  modelAttempts: 1,
  mock: true,
  error: null,
}
export const approval: ApprovalSnapshot = {
  approvalId: 'approval-1',
  operationId: 'op-1',
  actorUserId: 7,
  knowledgeBaseId: 12,
  targetVersion: 1,
  title: '契约验证',
  content: ai.answer,
  sourceDependencies: [{ knowledgeBaseId: 12, documentId: 101, documentVersion: 1 }],
  expiresAt: '2099-01-01T00:00:00Z',
  status: 'WAITING',
  documentId: null,
}
export const task: TaskSnapshot = {
  taskId: 51,
  requesterUserId: 7,
  taskType: 'FAQ',
  status: 'QUEUED',
  stateVersion: 1,
  modelAttempts: 0,
  completedSteps: 0,
  errorCode: null,
  artifactId: null,
}
export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
