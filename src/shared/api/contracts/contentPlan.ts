import { z } from 'zod'

const count = z.number().int().nonnegative().refine(Number.isSafeInteger)
export const outputPlanSchema = z.object({
  version: count,
  taskType: z.string(),
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
export const contentPlanSchema = z.object({
  plan: outputPlanSchema,
  planHash: z.string(),
  completedUnits: count,
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
