import { z } from 'zod'

export const id = z.number().int().positive().refine(Number.isSafeInteger, 'ID 超出安全整数范围')
const count = z.number().int().nonnegative().refine(Number.isSafeInteger)
const version = id
const timestamp = z.iso.datetime({ offset: true })
export const scopeSchema = z.object({
  mode: z.enum(['SELF', 'SELECTED', 'ALL']),
  knowledgeBaseIds: z.array(id),
  ownerUserId: id.nullable(),
})
export const userSchema = z.object({
  id,
  username: z.string(),
  role: z.string(),
  enabled: z.boolean(),
  permissionVersion: count,
  passwordChangeRequired: z.boolean(),
})
export const loginSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  user: userSchema,
})
export const createdUserSchema = z.object({ user: userSchema, temporaryPassword: z.string() })
export const baseSchema = z.object({
  id,
  ownerUserId: id,
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  deleted: z.boolean(),
  version,
})
export const documentSchema = z.object({
  id,
  knowledgeBaseId: id,
  ownerUserId: id,
  title: z.string(),
  format: z.string(),
  documentVersion: version,
  ingestionStatus: z.string(),
  activeProcessingRevision: version.nullable(),
})
export const dependencySchema = z.object({
  knowledgeBaseId: id,
  documentId: id,
  documentVersion: version,
})
export const contentSchema = z.object({
  document: documentSchema,
  text: z.string(),
  sourceDependencies: z.array(dependencySchema),
})
export const sectionSchema = z.object({
  sectionId: z.string(),
  parentSectionId: z.string().nullable(),
  ancestorSectionIds: z.array(z.string()),
  headingPath: z.string(),
  ordinal: count,
  startOffset: count,
  endOffset: count,
})
export const chunkSchema = z.object({
  chunkId: z.string(),
  sectionId: z.string(),
  contextParentId: z.string(),
  chunkIndexInSection: count,
  chunkIndexInParent: count,
  startOffset: count,
  endOffset: count,
  rawText: z.string(),
  embeddingText: z.string(),
  chunkHash: z.string(),
  blockType: z.string().optional(),
  blockId: z.string().nullable().optional(),
  partIndex: count.optional(),
  sourceMap: z
    .array(
      z.object({
        embeddingStartOffset: count,
        embeddingEndOffset: count,
        sourceStartOffset: count,
        sourceEndOffset: count,
        startLine: count,
        endLine: count,
        blockType: z.string(),
        blockId: z.string(),
        partIndex: count,
        repeatedHeader: z.boolean(),
      }),
    )
    .optional(),
  tokenCount: count.optional(),
  countSource: z.string().optional(),
})
export const statisticsSchema = z.object({
  documentCount: count,
  receivedCount: count,
  readyCount: count,
})
export const evidenceSchema = z.object({
  evidenceId: z.string(),
  document: documentSchema,
  processingRevision: version,
  // Raw document tools and inherited history may cite offsets without a section.
  sectionId: z.string().nullable(),
  headingPath: z.string(),
  matchedChunkIds: z.array(z.string()),
  includedChunkIds: z.array(z.string()),
  startOffset: count,
  endOffset: count,
  text: z.string(),
})
export const routeSchema = z.object({
  policyVersion: z.string(),
  qualityVersion: z.string(),
  profile: z.string(),
  routingMode: z.string(),
  selectedModelId: z.string(),
  selectionReason: z.string(),
  fallbackCandidates: z.array(z.string()),
  attempts: z.array(
    z.object({
      modelId: z.string(),
      outcome: z.string(),
      reservedInputTokens: count,
      countSource: z.string(),
      inputTokens: count.nullable(),
      outputTokens: count.nullable(),
      usageSource: z.string(),
      priceRef: z.string(),
    }),
  ),
})
export const aiSchema = z.object({
  status: z.string(),
  answer: z.string(),
  citations: z.array(evidenceSchema),
  traceId: z.string(),
  modelId: z.string(),
  modelAttempts: count,
  mock: z.boolean(),
  error: z.string().nullable(),
  sessionId: id.nullable().optional(),
  sessionVersion: version.nullable().optional(),
  route: routeSchema.nullable().optional(),
})
export const approvalSchema = z.object({
  approvalId: z.string(),
  operationId: z.string(),
  actorUserId: id,
  knowledgeBaseId: id,
  targetVersion: version,
  title: z.string(),
  content: z.string(),
  sourceDependencies: z.array(dependencySchema),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.string(),
  documentId: id.nullable(),
})
export const memorySchema = z.object({ id, userId: id, content: z.string(), version })
export const traceSchema = z.object({
  traceId: z.string(),
  actorUserId: id,
  status: z.string(),
  modelId: z.string(),
  attempts: count,
  mock: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  endedAt: timestamp.nullable().optional(),
  sessionId: id.nullable().optional(),
  taskId: id.nullable().optional(),
  ingestionId: id.nullable().optional(),
  previousTraceId: z.string().nullable().optional(),
  incomplete: z.boolean().optional(),
  telemetryDropped: z.boolean().optional(),
  nodeCount: count.optional(),
  firstDeliverableAt: timestamp.nullable().optional(),
})
export const taskProgressSchema = z.object({
  stage: z.string(),
  message: z.string(),
  workerEnabled: z.boolean(),
  executionActive: z.boolean(),
  completedSteps: count,
  totalSteps: count,
  percent: z.number().min(0).max(100),
  currentSteps: z.array(z.string()),
  steps: z.array(
    z.object({
      stepId: z.string(),
      label: z.string(),
      status: z.string(),
      startedAt: timestamp.nullable(),
      completedAt: timestamp.nullable(),
      errorCode: z.string().nullable(),
    }),
  ),
  startedAt: timestamp.nullable(),
  updatedAt: timestamp.nullable(),
  lastHeartbeatAt: timestamp.nullable(),
  elapsedExecutionSeconds: count,
  pollAfterMillis: count,
})
export const coverageSchema = z.object({
  documentId: id,
  documentVersion: version,
  processingRevision: version,
  sectionId: z.string(),
  completedPages: count,
  readStartOffset: count,
  readEndOffset: count,
  remainingStartOffset: count,
  remainingEndOffset: count,
  complete: z.boolean(),
  countSource: z.string(),
})
export const taskSchema = z.object({
  taskId: id,
  requesterUserId: id,
  taskType: z.string(),
  status: z.string(),
  stateVersion: count,
  modelAttempts: count,
  completedSteps: count,
  errorCode: z.string().nullable(),
  artifactId: id.nullable(),
  progress: taskProgressSchema.nullable().optional(),
  coverage: z.array(coverageSchema).optional(),
})
export const sessionSchema = z.object({
  id,
  title: z.string(),
  version,
  scope: scopeSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
})
export const sessionMessageSchema = z.object({
  seq: count,
  role: z.string(),
  status: z.string(),
  content: z.string().nullable(),
  sourceDependencies: z.array(dependencySchema),
  sourceReferences: z.array(
    z.object({
      dependency: dependencySchema,
      processingRevision: version.nullable(),
      sectionId: z.string().nullable(),
      startOffset: count.nullable(),
      endOffset: count.nullable(),
    }),
  ),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  createdAt: timestamp,
  scope: scopeSchema,
})
export const sectionPageSchema = z.object({
  documentId: id,
  documentVersion: version,
  processingRevision: version,
  sectionId: z.string(),
  headingPath: z.string(),
  sectionStartOffset: count,
  sectionEndOffset: count,
  startOffset: count,
  endOffset: count,
  text: z.string(),
  nextOffset: count.nullable(),
  complete: z.boolean(),
  remainingStartOffset: count,
  remainingEndOffset: count,
  tokenCount: count,
  countSource: z.string(),
})
export const ingestionSchema = z.object({
  documentId: id,
  documentVersion: version,
  activeProcessingRevision: version.nullable(),
  ingestionId: id,
  processingRevision: version,
  status: z.string(),
  errorCode: z.string().nullable(),
  expectedChunkCount: count,
  configHash: z.string().nullable(),
  parserVersion: z.string().nullable(),
  splitPolicyVersion: z.string().nullable(),
  mappingVersion: z.string().nullable(),
  tokenizerRef: z.string().nullable(),
  countSource: z.string().nullable(),
  progress: z
    .object({
      phase: z.string(),
      failureStage: z.string().nullable(),
      claims: count,
      modelAttempts: count,
      reservedInputTokens: count,
      actualInputTokens: count,
      unknownUsageAttempts: count,
      deadline: timestamp.nullable(),
      nextAttemptAt: timestamp.nullable(),
      retryable: z.boolean(),
      plannedBatches: count,
      embeddedBatches: count,
      indexedBatches: count,
      unknownBatches: count,
      peakVectorItems: count,
    })
    .nullable(),
})
export const toolSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  resultContract: z.string(),
  type: z.string(),
  requiredCapabilities: z.array(z.string()),
  enabled: z.boolean(),
  timeoutSeconds: count,
  retryable: z.boolean(),
})
export const tracePayloadSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
  originalChars: count,
})
export const spanSchema = z.object({
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  type: z.string(),
  name: z.string(),
  stepId: z.string().nullable(),
  agentId: z.string().nullable(),
  dependsOn: z.array(z.string()),
  sequence: count,
  status: z.string(),
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  errorCode: z.string().nullable(),
  modelId: z.string().nullable(),
  taskType: z.string().nullable(),
  profile: z.string().nullable(),
  policyVersion: z.string().nullable(),
  routeReason: z.string().nullable(),
  attempt: count.nullable(),
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  usageSource: z.string().nullable(),
  toolCallHash: z.string().nullable(),
  input: tracePayloadSchema.nullish(),
  output: tracePayloadSchema.nullish(),
  payloadSources: z
    .array(
      z.object({
        knowledgeBaseId: id,
        documentId: id,
        documentVersion: count,
      }),
    )
    .optional(),
})
export const graphSchema = z.object({
  run: traceSchema,
  nodes: z.array(spanSchema),
  edges: z.array(
    z.object({ from: z.string(), to: z.string(), kind: z.enum(['CALL', 'DEPENDENCY']) }),
  ),
  missingNodeIds: z.array(z.string()),
  incomplete: z.boolean(),
  costStatus: z.string(),
})
export type Id = number
export type Role = 'USER' | 'ADMIN'
export type ScopeMode = 'SELF' | 'SELECTED' | 'ALL'
export interface ScopeRequest {
  mode: ScopeMode
  knowledgeBaseIds: Id[]
  ownerUserId: Id | null
}
export type UserSnapshot = z.infer<typeof userSchema>
export type LoginResult = z.infer<typeof loginSchema>
export type KnowledgeBaseSnapshot = z.infer<typeof baseSchema>
export type DocumentSnapshot = z.infer<typeof documentSchema>
export type DocumentContent = z.infer<typeof contentSchema>
export type SourceDependency = z.infer<typeof dependencySchema>
export type SectionSnapshot = z.infer<typeof sectionSchema>
export type ChunkSnapshot = z.infer<typeof chunkSchema>
export type KnowledgeStatistics = z.infer<typeof statisticsSchema>
export type EvidenceBundle = z.infer<typeof evidenceSchema>
export type AiResult = z.infer<typeof aiSchema>
export type ApprovalSnapshot = z.infer<typeof approvalSchema>
export type MemorySnapshot = z.infer<typeof memorySchema>
export type TraceSnapshot = z.infer<typeof traceSchema>
export type TaskSnapshot = z.infer<typeof taskSchema>
export type SessionSnapshot = z.infer<typeof sessionSchema>
export type SessionMessage = z.infer<typeof sessionMessageSchema>
export type SectionPage = z.infer<typeof sectionPageSchema>
export type IngestionMetadata = z.infer<typeof ingestionSchema>
export type TraceGraph = z.infer<typeof graphSchema>
export type TraceSpan = z.infer<typeof spanSchema>
export interface ChatOptions {
  sessionId?: number
  sessionVersion?: number
  modelProfile?: 'knowledge' | 'economy' | 'analysis' | 'report'
  responseFormat?: 'TEXT' | 'STRUCTURED'
  toolMode?: 'OFF' | 'READ_ONLY'
}
