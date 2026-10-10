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
export const isLearningTask = (type: string) =>
  ['QUIZ_GENERATION', 'KNOWLEDGE_COMPILATION'].includes(type)
export const isRetiredTask = (type: string) => ['FAQ', 'RESEARCH_REPORT'].includes(type)
export function availableTaskActions(type: string, status: string) {
  const actions = taskActions[status] ?? []
  return ['NOTES_PPT', 'NOTES_VIDEO'].includes(type) &&
    ['FAILED', 'NEEDS_RECONCILIATION'].includes(status)
    ? ['resume' as const, ...actions]
    : actions
}
export const taskTypeLabels: Record<string, string> = {
  QUIZ_GENERATION: '学习自测',
  KNOWLEDGE_COMPILATION: '资料整编',
  NOTES_PPT: '演示文稿',
  NOTES_VIDEO: '教学视频',
  FAQ: '常见问题 FAQ（历史）',
  RESEARCH_REPORT: '研究报告（历史）',
}
export const taskErrorMessages: Record<string, string> = {
  RATE_LIMITED: '模型或执行池并发额度已满，请保留任务 ID，核对服务端并发限制后再处理。',
  MODEL_RATE_LIMITED: '模型提供方限流，请保留任务 ID，核对服务端状态后再处理。',
  INDEX_NOT_READY: '所选资料尚未完成入库，请先检查文档状态。',
  WORKFLOW_INPUT_TOO_LARGE:
    '资料为空或超过原文容量，请缩小范围（默认合计最多 1,000,000 UTF-8 字节）。',
  WORKFLOW_REQUIREMENTS_UNSATISFIED: '结果未满足备注或数量要求，请保留任务 ID 核对资料与要求。',
  WORKFLOW_PLAN_BUDGET_EXCEEDED: '内容计划超过任务资源预算，请缩小资料范围或数量要求。',
  WORKFLOW_UNIT_TOO_LARGE: '单个内容单元超过输出容量，请调整资料或结构要求。',
  WORKFLOW_INDEX_CAPACITY_EXCEEDED: '事实索引超过容量，请缩小资料范围。',
  WORKFLOW_EXTRACTION_CAPACITY_EXCEEDED: '资料提取超过容量，请缩小资料范围。',
  WORKFLOW_NEEDS_INPUT: '未提取到足够可用内容，请调整资料。',
  CONTEXT_VERSION_CONFLICT: '来源已变化，请核对当前文档。',
  MODEL_CONTEXT_INSUFFICIENT: '当前模型容量不足。',
  MODEL_STRUCTURED_INVALID: '模型返回的内容结构未通过校验，请保留任务 ID 联系后端排查。',
  MODEL_REPAIR_EXHAUSTED: '模型内容修复后仍未通过校验，请保留任务 ID 联系后端排查。',
  WORKFLOW_REVIEW_REJECTED: '局部修复后仍未通过模型质检。',
  BUDGET_EXCEEDED: '任务额度已耗尽，恢复不会补充预算。',
  SKILL_UNAVAILABLE: '服务端学习工作流暂不可用。',
  WORKFLOW_RESULT_UNAVAILABLE: '学习结果尚未发布，请核对任务状态。',
  WORKFLOW_EXECUTOR_UNAVAILABLE: '保存的执行版本不可用，请联系后端排查。',
  WORKFLOW_RETIRED: '旧 FAQ／研究报告已停用，仅可读取合法历史记录和产物。',
}
