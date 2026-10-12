import { z } from 'zod'
const count = z.number().int().nonnegative().safe()
const text = z.string().nullable()
export const diagnosticSchema = z.object({
  schemaId: text,
  origin: text,
  collectionTruncated: z.boolean(),
  stoppedEarly: z.boolean(),
  items: z.array(
    z.object({
      issue: z.object({
        path: text,
        rule: text,
        actual: z.number().int().nullable(),
        maximum: z.number().int().nullable(),
        unit: text,
        expected: text,
      }),
      pointer: text,
      actualType: text,
      excerptRaw: text,
      start: count.nullable(),
      end: count.nullable(),
      excerptTruncated: z.boolean(),
      line: count.nullable(),
      column: count.nullable(),
      locationBasis: text,
    }),
  ),
})
export const payloadRefSchema = z.object({
  payloadId: text,
  state: z.string(),
  rawBytes: count,
  storedBytes: count,
  charCount: count,
  chunkCount: count,
  checksum: text,
  preview: z.string().max(1000).nullable(),
  redacted: z.boolean(),
  expiresAt: text,
})
export const observationSchema = z.object({
  callId: text,
  callStatus: z.string(),
  validationStatus: z.string(),
  schemaId: text,
  httpMillis: count,
  validationMillis: count,
  archiveMillis: count,
  input: payloadRefSchema.nullable(),
  output: payloadRefSchema.nullable(),
})
export const callSchema = z.object({
  callId: z.string(),
  context: z.object({
    traceId: z.string(),
    taskId: count,
    taskType: z.string(),
    stage: text,
    operation: text,
    businessNodeId: text,
    schemaId: text,
    schemaVersion: text,
    contractHash: text,
  }),
  spanId: text,
  parentSpanId: text,
  modelId: text,
  attempt: count,
  sendState: z.string(),
  callStatus: z.string(),
  validationStatus: z.string(),
  errorCode: text,
  httpMillis: count,
  validationMillis: count,
  diagnostic: diagnosticSchema.nullable(),
  startedAt: text,
  endedAt: text,
})
export const callDetailSchema = z.object({
  call: callSchema,
  input: payloadRefSchema,
  output: payloadRefSchema,
})
export const payloadPageSchema = z.object({
  payload: payloadRefSchema,
  content: z.string().max(16384),
  nextCursor: text,
  contentKind: z.string(),
})
export type ModelCall = z.infer<typeof callSchema>
export type PayloadRef = z.infer<typeof payloadRefSchema>
