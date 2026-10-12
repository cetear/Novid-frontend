import { z } from 'zod'
const integer = z.number().int().safe()
const count = integer.nonnegative()
export const retryPlanSchema = z.object({
  taskId: integer.positive(),
  stateVersion: integer.positive(),
  canContinue: z.boolean(),
  errorCode: z.string().nullable(),
  blockers: z.array(z.string()),
  remainingExecutionSeconds: integer,
  remainingTurns: integer,
  remainingAttempts: integer,
  remainingTools: integer,
  remainingRepairs: integer,
  completedNodes: count,
  pendingNodes: count,
  acceptedPackages: count,
  pendingPackages: count,
  currency: z.string(),
  remainingAmount: z.number().finite(),
  remainingTokens: integer,
})
export const retryRequestSchema = z.object({
  mode: z.literal('CONTINUE'),
  expectedStateVersion: integer.positive(),
  additionalExecutionSeconds: count.max(86400),
  additionalTurns: count.max(10000),
  additionalAttempts: count.max(20000),
  additionalTools: count.max(10000),
  additionalRepairs: count.max(10000),
  additionalTokens: count.max(10000000),
  additionalAmount: z
    .number()
    .finite()
    .min(0)
    .max(1000000)
    .refine((value) => /^\d+(\.\d{1,8})?$/.test(String(value)), '金额最多 8 位小数'),
})
export type RetryPlan = z.infer<typeof retryPlanSchema>
export type RetryRequest = z.infer<typeof retryRequestSchema>
