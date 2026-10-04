export const taskActions: Record<string, Array<'pause' | 'resume' | 'cancel'>> = {
  QUEUED: ['pause', 'cancel'],
  RUNNING: ['pause', 'cancel'],
  PAUSED: ['resume', 'cancel'],
  SUCCEEDED: [],
  PARTIAL: [],
  FAILED: [],
  CANCELLED: [],
}
export const isTaskActive = (status: string) => status === 'QUEUED' || status === 'RUNNING'
