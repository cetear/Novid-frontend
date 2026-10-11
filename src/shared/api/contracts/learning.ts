import { z } from 'zod'
import { id } from './backend'
import { learningPlanSchema, coverageSchema } from './contentPlan'

const offset = z.number().int().nonnegative().refine(Number.isSafeInteger)
export const quizOptionsSchema = z
  .object({
    questionCount: z.number().int().min(0).max(512),
    questionTypes: z
      .array(z.enum(['SINGLE_CHOICE', 'SHORT_ANSWER']))
      .min(1)
      .max(2)
      .refine((types) => new Set(types).size === types.length, '题型不能重复'),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  })
  .strict()
export const compilationOptionsSchema = z
  .object({
    detailLevel: z.enum(['CONCISE', 'DETAILED']),
    maximumChapters: z.number().int().min(0).max(512),
  })
  .strict()
export const learningCitationSchema = z.object({
  itemId: z.string(),
  source: z.object({
    id: z.string(),
    knowledgeBaseId: id,
    documentId: id,
    documentVersion: id,
    processingRevision: id,
    title: z.string(),
    startOffset: offset,
    endOffset: offset,
    textHash: z.string(),
  }),
  quoteStartOffset: offset,
  quoteEndOffset: offset,
  quote: z.string(),
})
export const learningResultSchema = z.object({
  contentPlan: learningPlanSchema.refine((p) =>
    p.taskType === 'QUIZ_GENERATION'
      ? p.quiz !== null && p.compilation === null
      : p.compilation !== null && p.quiz === null,
  ),
  coverageReport: z.array(coverageSchema),
  workflowId: z.string(),
  title: z.string(),
  quiz: z
    .object({
      title: z.string(),
      questions: z.array(
        z.object({
          id: z.string(),
          type: z.enum(['SINGLE_CHOICE', 'SHORT_ANSWER']),
          stem: z.string(),
          options: z.array(z.string()),
          answer: z.string(),
          explanation: z.string(),
          itemIds: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
  outline: z
    .object({
      title: z.string(),
      chapters: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          parentId: z.string(),
          groups: z.array(
            z.object({
              id: z.string(),
              heading: z.string(),
              relation: z.string(),
              itemIds: z.array(z.string()),
            }),
          ),
        }),
      ),
    })
    .nullable(),
  chapters: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      sections: z.array(
        z.object({ groupId: z.string(), body: z.string(), itemIds: z.array(z.string()) }),
      ),
    }),
  ),
  citations: z.array(learningCitationSchema),
  fullSourceRead: z.boolean(),
  qualityStatus: z.string(),
})
export type QuizOptions = z.infer<typeof quizOptionsSchema>
export type CompilationOptions = z.infer<typeof compilationOptionsSchema>
export type LearningResult = z.infer<typeof learningResultSchema>
export type LearningCitation = z.infer<typeof learningCitationSchema>
