import type { DocumentSnapshot } from '@/shared/api/contracts/backend'
export interface ProcessingBaseline {
  version: number
  revision: number
}
export function processingOutcome(baseline: ProcessingBaseline, document: DocumentSnapshot) {
  if (document.documentVersion !== baseline.version) return 'changed'
  if ((document.activeProcessingRevision ?? 0) > baseline.revision) return 'activated'
  return 'waiting'
}
