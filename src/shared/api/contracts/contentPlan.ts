import { z } from 'zod'

const count = z.number().int().nonnegative().refine(Number.isSafeInteger)
export const outputPlanSchema = z.object({
  version: z.literal(2),
  taskType: z.literal('NOTES_PPT'),
  sourceHash: z.string(),
  intent: z.object({
    title: z.string(),
    themes: z.array(z.object({ id: z.string(), title: z.string(), purpose: z.string() })),
    requirements: z.string(),
    reason: z.string(),
    requestedUnits: z.string(),
  }),
  units: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      themeId: z.string(),
      title: z.string(),
      purpose: z.string(),
      relation: z.string(),
      imageMode: z.string(),
      imagePrompt: z.string(),
      itemIds: z.array(z.string()),
    }),
  ),
  omissions: z.array(z.object({ itemIds: z.array(z.string()), reason: z.string() })),
  counts: z.object({
    questions: count,
    chapters: count,
    sections: count,
    contentSlides: count,
    sourceSlides: count,
    totalSlides: count,
  }),
  requiredNodes: z.array(z.string()),
  estimatedTurns: count,
  estimatedAttempts: count,
  estimatedOutputBytes: count,
})
const strings = z.array(z.string())
const knowledge = z.object({
  id: z.string(),
  relation: z.string(),
  summary: z.string(),
  sourceItemIds: strings,
  conditions: strings,
})
const directoryChapter = z.object({
  id: z.string(),
  parentId: z.string(),
  title: z.string(),
  purpose: z.string(),
  exclusions: strings,
  resultDependencies: strings,
  relatedChapterIds: strings,
  terms: strings,
})
export const partSchema = z.object({
  id: z.string(),
  logicalId: z.string(),
  chapterId: z.string(),
  kind: z.string(),
  purpose: z.string(),
  ownedKnowledgeIds: strings,
  contextKnowledgeIds: strings,
  itemIds: strings,
  outputBytes: count,
})
export const workPackageSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  depth: count,
  partIds: strings,
  dependencies: strings,
  inputBytes: count,
  outputBytes: count,
})
export const packageStatusSchema = z.object({
  workPackage: workPackageSchema,
  parts: z.array(partSchema),
  status: z.enum(['PENDING', 'RUNNING', 'FAILED', 'REPLACED', 'ACCEPTED']),
  attempts: count,
  resultHash: z.string().nullable(),
  errorCode: z.string().nullable(),
  children: strings,
  acceptedParts: count,
})
export const learningPlanSchema = z.object({
  version: z.literal(3),
  taskType: z.enum(['QUIZ_GENERATION', 'KNOWLEDGE_COMPILATION']),
  sourceHash: z.string(),
  compilation: z
    .object({
      directory: z.object({
        title: z.string(),
        audience: z.string(),
        requirements: z.string(),
        reason: z.string(),
        chapters: z.array(directoryChapter),
        terms: strings,
      }),
      knowledge: z.array(knowledge),
      sections: z.array(
        z.object({
          id: z.string(),
          chapterId: z.string(),
          title: z.string(),
          purpose: z.string(),
          ownedKnowledgeIds: strings,
          contextKnowledgeIds: strings,
          outputBytes: count,
        }),
      ),
    })
    .nullable(),
  quiz: z
    .object({
      intent: z.object({
        title: z.string(),
        requirements: z.string(),
        reason: z.string(),
        coveragePolicy: z.string(),
        requestedQuestions: z.string(),
        focusChapterIds: strings,
      }),
      difficulty: z.string(),
      chapters: z.array(
        z.object({
          id: z.string(),
          parentId: z.string(),
          order: count,
          title: z.string(),
          origin: z.string(),
          ranges: z.array(
            z.object({
              fragmentId: z.string(),
              sectionId: z.string(),
              startOffset: count,
              endOffset: count,
            }),
          ),
          itemIds: strings,
        }),
      ),
      objectives: z.array(
        z.object({
          id: z.string(),
          primaryChapterId: z.string(),
          title: z.string(),
          cognition: z.string(),
          questionTypes: strings,
          itemIds: strings,
          priority: count,
          reason: z.string(),
          relatedChapterIds: strings,
        }),
      ),
      quotas: z.array(
        z.object({
          chapterId: z.string(),
          minimum: count,
          maximum: count,
          weight: count,
          allocated: count,
          reason: z.string(),
        }),
      ),
      slots: z.array(
        z.object({
          id: z.string(),
          primaryChapterId: z.string(),
          objectiveId: z.string(),
          cognition: z.string(),
          type: z.string(),
          itemIds: strings,
          relatedChapterIds: strings,
        }),
      ),
      uncovered: z.array(z.object({ kind: z.string(), id: z.string(), reason: z.string() })),
    })
    .nullable(),
  execution: z.object({
    parts: z.array(partSchema),
    packages: z.array(workPackageSchema),
    maximumPackages: count,
    maximumSplitDepth: count,
  }),
  counts: outputPlanSchema.shape.counts,
  requiredNodes: strings,
  estimatedTurns: count,
  estimatedAttempts: count,
  estimatedOutputBytes: count,
})
export const coverageSchema = z.object({
  id: z.string(),
  kind: z.string(),
  available: count,
  selected: count,
  relatedIds: strings,
  reason: z.string(),
})
export function planIntent(
  plan: z.infer<typeof outputPlanSchema> | z.infer<typeof learningPlanSchema>,
) {
  return plan.version === 2 ? plan.intent : (plan.compilation?.directory ?? plan.quiz?.intent)
}
export function logicalUnits(
  plan: z.infer<typeof outputPlanSchema> | z.infer<typeof learningPlanSchema>,
) {
  return plan.version === 2
    ? plan.units.length
    : (plan.compilation?.sections.length ?? plan.quiz?.slots.length ?? 0)
}
export const contentPlanSchema = z.object({
  plan: z
    .discriminatedUnion('version', [outputPlanSchema, learningPlanSchema])
    .refine(
      (p) =>
        p.version === 2 ||
        (p.taskType === 'QUIZ_GENERATION'
          ? p.quiz !== null && p.compilation === null
          : p.compilation !== null && p.quiz === null),
    ),
  planHash: z.string(),
  completedUnits: count,
  completedChapters: count,
  totalChapters: count,
  fullSourceRead: z.boolean(),
})
export const contentPlanRefSchema = z
  .object({
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().min(1),
    contentSlides: count.min(1).max(512),
    sourceSlides: count.min(1).max(4),
    totalSlides: count.min(2),
  })
  .refine((value) => value.contentSlides + value.sourceSlides === value.totalSlides)
export type OutputPlan = z.infer<typeof outputPlanSchema>
export type ContentPlanSnapshot = z.infer<typeof contentPlanSchema>
