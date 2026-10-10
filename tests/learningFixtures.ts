import type { LearningResult } from '@/shared/api/contracts/learning'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
import { task } from './fixtures'
import type { OutputPlan, ContentPlanSnapshot } from '@/shared/api/contracts/contentPlan'
export const quizPlan: OutputPlan = {
  version: 1,
  taskType: 'QUIZ_GENERATION',
  sourceHash: 'source-hash',
  intent: {
    title: '资料驱动验证自测',
    themes: [{ id: 't1', title: '验证', purpose: '依据资料检验理解' }],
    requirements: '',
    reason: '资料包含一个验证知识点，选择一题覆盖。',
    requestedUnits: '自动',
  },
  units: [
    {
      id: 'q1',
      kind: 'QUESTION',
      themeId: 't1',
      title: '验证依据',
      purpose: '检验理解',
      relation: '',
      imageMode: 'NONE',
      imagePrompt: '',
      itemIds: ['item-1'],
    },
  ],
  omissions: [],
  counts: {
    questions: 1,
    chapters: 0,
    sections: 0,
    contentSlides: 0,
    sourceSlides: 0,
    totalSlides: 0,
  },
  requiredNodes: ['prepare', 'extract', 'organize', 'generate', 'review', 'publish'],
  estimatedTurns: 4,
  estimatedAttempts: 6,
  estimatedOutputBytes: 2048,
}
export const contentPlan: ContentPlanSnapshot = {
  plan: quizPlan,
  planHash: 'a'.repeat(64),
  completedUnits: 1,
  fullSourceRead: true,
}
export const learningTask: TaskSnapshot = {
  ...task,
  taskType: 'QUIZ_GENERATION',
  status: 'RUNNING',
  completedSteps: 4,
  progress: {
    stage: 'REVIEWING',
    message: '正在质检',
    workerEnabled: true,
    executionActive: true,
    completedSteps: 4,
    totalSteps: 6,
    percent: 90,
    currentSteps: ['review'],
    steps: ['prepare', 'extract', 'organize', 'generate', 'review', 'publish'].map((stepId, i) => ({
      stepId,
      label: ['准备', '提取', '组织', '生成', '质检', '发布'][i]!,
      status: i < 4 ? 'SUCCEEDED' : i === 4 ? 'RUNNING' : 'PENDING',
      startedAt: null,
      completedAt: null,
      errorCode: null,
    })),
    startedAt: null,
    updatedAt: null,
    lastHeartbeatAt: null,
    elapsedExecutionSeconds: 20,
    pollAfterMillis: 2000,
  },
  coverage: [],
}
export const quizResult: LearningResult = {
  contentPlan: quizPlan,
  workflowId: 'learning-quiz-v1',
  title: '验证自测',
  quiz: {
    title: '验证知识',
    questions: [
      {
        id: 'q1',
        type: 'SINGLE_CHOICE',
        stem: '验证的依据是什么？',
        options: ['知识与验证', '猜测', '忽略', '跳过'],
        answer: 'A',
        explanation: '需要知识与验证。',
        itemIds: ['item-1'],
      },
    ],
  },
  outline: null,
  chapters: [],
  fullSourceRead: true,
  qualityStatus: 'MODEL_REVIEW_PASSED_PENDING_HUMAN',
  citations: [
    {
      itemId: 'item-1',
      source: {
        id: 'slice-1',
        knowledgeBaseId: 12,
        documentId: 101,
        documentVersion: 1,
        processingRevision: 1,
        title: '验证指南',
        startOffset: 1,
        endOffset: 5,
        textHash: 'source-hash',
      },
      quoteStartOffset: 2,
      quoteEndOffset: 5,
      quote: '与验证',
    },
  ],
}
export const compilationResult: LearningResult = {
  ...quizResult,
  contentPlan: {
    ...quizPlan,
    taskType: 'KNOWLEDGE_COMPILATION',
    counts: { ...quizPlan.counts, questions: 0, chapters: 1, sections: 1 },
  },
  workflowId: 'learning-compilation-v1',
  title: '验证整编',
  quiz: null,
  outline: {
    title: '复习资料',
    chapters: [
      {
        id: 'ch1',
        title: '验证步骤',
        groups: [{ id: 'g1', heading: '验证依据', relation: '先核对再执行', itemIds: ['item-1'] }],
      },
    ],
  },
  chapters: [
    {
      id: 'ch1',
      title: '验证步骤',
      sections: [{ groupId: 'g1', body: '依据资料进行验证。', itemIds: ['item-1'] }],
    },
  ],
}
