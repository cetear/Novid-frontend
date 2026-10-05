export const taskActions: Record<string, Array<'pause' | 'resume' | 'cancel'>> = {
  QUEUED: ['pause', 'cancel'],
  RUNNING: ['pause', 'cancel'],
  PAUSED: ['resume', 'cancel'],
  SUCCEEDED: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
  WAITING_APPROVAL: ['cancel'],
  WAITING_EXTERNAL: ['pause', 'cancel'],
  WAITING_MEDIA_REVIEW: ['cancel'],
  NEEDS_RECONCILIATION: ['cancel'],
  MEDIA_READY: [],
}
export const isTaskActive = (status: string) =>
  ['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'].includes(status)
