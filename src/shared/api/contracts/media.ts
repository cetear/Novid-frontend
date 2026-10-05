import { z } from 'zod'
import { id, dependencySchema, coverageSchema } from './backend'

const count = z.number().int().nonnegative().refine(Number.isSafeInteger)
const time = z.iso.datetime({ offset: true })
export const amount = z
  .union([z.string().regex(/^\d+(\.\d{1,8})?$/), z.number().finite().nonnegative()])
  .transform(String)
export const feeSchema = z.object({
  kind: z.string(),
  resourceId: z.string(),
  currency: z.string().nullable(),
  limitAmount: amount.nullable(),
  estimatedAmount: amount,
  reservedAmount: amount,
  providerInputTokens: count,
  providerOutputTokens: count,
  reservedTokens: count,
  attempts: count,
  settledAttempts: count,
  unknownAttempts: count,
  pendingAttempts: count,
  simulatedAttempts: count,
  legacyUntrackedAttempts: count,
  overLimit: z.boolean(),
  costStatus: z.string(),
})
export const feeAggregateSchema = z.object({
  currency: z.string(),
  attempts: count,
  unknownAttempts: count,
  pendingAttempts: count,
  simulatedAttempts: count,
  estimatedAmount: amount,
  reservedAmount: amount,
})
export const auditSchema = z.object({
  id,
  actorUserId: id,
  action: z.string(),
  resourceId: id.nullable(),
  scopeMode: z.string(),
  permissionVersion: count.nullable(),
  knowledgeEpoch: count.nullable(),
  resultCount: count.nullable(),
  outcome: z.string(),
  createdAt: time,
  knowledgeBaseIds: z.array(id).nullable().optional(),
  ownerUserId: id.nullable().optional(),
  resourceIds: z.array(id).nullable().optional(),
})
export const metricsSchema = z.object({
  runs: count,
  failedRuns: count,
  incompleteRuns: count,
  queuedTasks: count,
  pendingOutbox: count,
  accessEvents: count,
  queryCacheHits: count,
  queryCacheMisses: count,
  queryCacheEntries: count,
})
const priceSchema = z.object({
  ref: z.string(),
  version: z.string(),
  currency: z.string(),
  unit: z.string(),
  effectiveAt: time,
  inputRate: amount,
  outputRate: amount,
})
export const capabilitySchema = z.object({
  id: z.string(),
  version: id,
  configurationHash: z.string(),
  provider: z.string(),
  accountNamespace: z.string(),
  model: z.string(),
  region: z.string(),
  durations: z.array(id),
  resolutions: z.array(z.string()),
  audioModes: z.array(z.string()),
  prices: z.record(z.string(), priceSchema),
  verificationStatus: z.string(),
  pollIntervalSeconds: count,
  maxPolls: count,
})
export const catalogSchema = z.object({
  id: z.string(),
  kind: z.string(),
  version: id,
  label: z.string(),
  enabled: z.boolean(),
  provider: z.string(),
  mappingKind: z.string(),
  mappingValue: z.string(),
  providerMappings: z.record(z.string(), z.string()).optional(),
})
export const unitSchema = z.object({
  unitId: z.string(),
  title: z.string(),
  text: z.string(),
  notes: z.string(),
  layout: z.string(),
  imageMode: z.string(),
  imagePrompt: z.string(),
  references: z.array(z.string()),
  seconds: count,
})
const fileSchema = z.object({
  storageKey: z.string(),
  mime: z.string(),
  size: count,
  checksum: z.string(),
})
const imageSourceSchema = z.object({
  candidateId: z.string(),
  query: z.string(),
  sourcePageUrl: z.string(),
  imageUrl: z.string(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  license: z.string().nullable(),
  objectAndPeriod: z.string().nullable(),
  retrievedAt: time,
})
export const previewSchema = z.object({
  taskId: id,
  previewVersion: id,
  planVersion: id,
  hash: z.string(),
  status: z.string(),
  approvalId: z.string().nullable(),
  expiresAt: time.nullable(),
  configurationHash: z.string(),
  currency: z.string(),
  estimatedAmount: amount.nullable(),
  maximumAmount: amount,
  units: z.array(unitSchema),
  sourceDependencies: z.array(dependencySchema),
  coverage: z.array(coverageSchema),
  catalogs: z.array(catalogSchema),
  qualityStatus: z.string(),
  assets: z.array(
    z.object({
      assetId: z.string(),
      unitId: z.string(),
      kind: z.string(),
      operationId: z.string().nullable(),
      file: fileSchema.nullable(),
      webSource: imageSourceSchema.nullable(),
      artifactId: id.nullable(),
    }),
  ),
  storyboard: z
    .object({
      storyboardVersion: id,
      hash: z.string(),
      aspectRatio: z.string(),
      mappingRule: z.string(),
      durationTiers: z.array(id),
      shots: z.array(
        z.object({
          shotId: z.string(),
          narration: z.string(),
          visualPrompt: z.string(),
          motionPrompt: z.string(),
          generationType: z.string(),
          referenceAssetIds: z.array(z.string()),
          sourceRefs: z.array(z.string()),
          estimatedDurationMs: count,
          maximumDurationSeconds: count,
          video: z
            .object({
              capability: capabilitySchema,
              resolution: z.string(),
              audioMode: z.string(),
              seconds: id,
              reason: z.string(),
            })
            .nullable(),
        }),
      ),
    })
    .nullable(),
})
export const operationSchema = z.object({
  operationId: z.string(),
  taskId: id,
  previewVersion: id,
  unitId: z.string(),
  capability: z.string(),
  state: z.string(),
  providerJobId: z.string().nullable(),
  providerStatus: z.string().nullable(),
  pollCount: count,
  lastPollAt: time.nullable(),
  nextPollAt: time.nullable(),
  deadline: time.nullable(),
  errorCode: z.string().nullable(),
  assetId: z.string().nullable(),
  costStatus: z.string(),
})
export const mediaPlanSchema = z.object({
  plan: z.object({
    planVersion: id,
    schemaVersion: z.string(),
    steps: z.array(
      z.object({
        stepId: z.string(),
        action: z.string(),
        agentId: z.string(),
        dependsOn: z.array(z.string()),
        inputRefs: z.array(z.string()),
        when: z.string(),
        completionCondition: z.string(),
      }),
    ),
  }),
  hash: z.string(),
  modelId: z.string(),
  policyVersion: z.string(),
})
export const videoProgressSchema = z.object({
  totalShots: count,
  completedShots: count,
  activeShotId: z.string().nullable(),
  renderPhase: z.string(),
  waitReason: z.string().nullable(),
  operations: z.array(operationSchema),
  shots: z.array(
    z.object({
      shotId: z.string(),
      approvalHash: z.string(),
      audioDurationMs: count.nullable(),
      providerDurationSeconds: count.nullable(),
      timelineStartMs: count.nullable(),
      timelineEndMs: count.nullable(),
      audioAssetId: z.string().nullable(),
      videoAssetId: z.string().nullable(),
      renderedAssetId: z.string().nullable(),
    }),
  ),
})
export const presentationSchema = z.object({
  pptx: fileSchema,
  artifactId: id.nullable(),
  pages: z.array(
    z.object({ number: id, unitId: z.string(), preview: fileSchema, artifactId: id.nullable() }),
  ),
  check: z.object({
    taskId: id,
    previewVersion: id,
    planVersion: id,
    approvalHash: z.string(),
    inputHash: z.string(),
    layoutVersion: z.string(),
    font: z.string(),
    slideCount: count,
    structuralStatus: z.string(),
    qualityStatus: z.string(),
    warnings: z.array(z.string()),
    images: z.array(
      z.object({
        unitId: z.string(),
        assetId: z.string(),
        kind: z.string(),
        checksum: z.string(),
        operationId: z.string().nullable(),
        source: imageSourceSchema.nullable(),
      }),
    ),
    sources: z.array(dependencySchema),
    coverage: z.array(coverageSchema),
  }),
})
export type FeeSummary = z.infer<typeof feeSchema>
export type MediaPreview = z.infer<typeof previewSchema>
export type MediaUnit = z.infer<typeof unitSchema>
export type VideoCapability = z.infer<typeof capabilitySchema>
export type CatalogItem = z.infer<typeof catalogSchema>
export type PresentationBundle = z.infer<typeof presentationSchema>
export type TaskType = 'FAQ' | 'RESEARCH_REPORT' | 'NOTES_PPT' | 'NOTES_VIDEO'
export interface PresentationOptions {
  pageCount: number
  themeId: 'default'
  maximumAmount: string
  imagePolicy: 'MIXED' | 'CONCEPT' | 'FACTUAL'
}
export interface VideoOptions {
  characterId: string
  voiceId: string
  sceneId: string
  seconds: number
  maximumAmount: string
  shotCount: number
  burnSubtitles: boolean
}
export interface VideoRecommendation {
  shotId: string
  profileId: string
  resolution: string
  audioMode: 'NATIVE' | 'NONE'
  seconds: number
  reason: string
}
