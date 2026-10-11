import { z } from 'zod'
import { id, sectionSchema, dependencySchema, approvalSchema, documentSchema } from './backend'
import { learningCitationSchema } from './learning'
const count = z.number().int().nonnegative().refine(Number.isSafeInteger)
const strings = z.array(z.string())
export const readPlanSchema = z.object({
  plan: z.object({
    protocol: z.literal('structure-read-v1'),
    documents: z.array(
      z.object({
        knowledgeBaseId: id,
        documentId: id,
        documentVersion: id,
        processingRevision: id,
        title: z.string(),
        format: z.string(),
        textHash: z.string(),
        textLength: count,
        sections: z.array(sectionSchema),
      }),
    ),
    fragments: z.array(
      z.object({
        source: learningCitationSchema.shape.source,
        naturalId: z.string(),
        sectionId: z.string(),
        headingPath: z.string(),
        blockType: z.string(),
        partIndex: count,
        contexts: z.array(z.object({ startOffset: count, endOffset: count, role: z.string() })),
        splitReason: z.string(),
      }),
    ),
    packs: z.array(
      z.object({ packId: z.string(), documentId: id, fragmentIds: strings, inputBytes: count }),
    ),
    sources: z.array(dependencySchema),
  }),
  planHash: z.string(),
  completedFragments: count,
  completedPacks: count,
  fullSourceRead: z.boolean(),
  topicCards: z.array(
    z.object({
      id: z.string(),
      fragmentId: z.string(),
      sectionId: z.string(),
      headingPath: z.string(),
      topic: z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        keywords: strings,
        entities: strings,
        contentRole: z.string(),
        conditions: strings,
        relations: strings,
        dependencyItemIds: strings,
        itemIds: strings,
      }),
      factCount: count,
      sourceBytes: count,
    }),
  ),
})
export const compilationSaveSchema = z.object({
  approval: approvalSchema,
  document: documentSchema.nullable(),
})
export const originSchema = z.object({
  originType: z.string(),
  generatedVersion: count,
  taskId: id.nullable(),
  resultHash: z.string().nullable(),
  generatedAt: z.string().nullable(),
  mappingValid: z.boolean(),
  directSources: z.array(dependencySchema.extend({ sourceOrder: count, title: z.string() })),
  sections: z.array(
    z.object({
      chapterId: z.string(),
      sectionId: z.string(),
      startOffset: count,
      endOffset: count,
      evidence: z.array(learningCitationSchema),
      chapterPath: z.array(z.object({ id: z.string(), parentId: z.string(), title: z.string() })),
    }),
  ),
  bindingStatus: z.string(),
  parsedBindings: z.array(
    z.object({
      chapterId: z.string(),
      logicalSectionId: z.string(),
      parsedSectionId: z.string(),
      processingRevision: id,
      startOffset: count,
      endOffset: count,
      mappingHash: z.string(),
    }),
  ),
})
export const participationSchema = z.object({
  documentId: id,
  knowledgeBaseId: id,
  title: z.string(),
  currentVersion: id,
  sourceVersions: z.array(id),
})
export type ReadPlan = z.infer<typeof readPlanSchema>
