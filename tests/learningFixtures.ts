import type { LearningResult } from '@/shared/api/contracts/learning'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
import { task } from './fixtures'
import type { ContentPlanSnapshot } from '@/shared/api/contracts/contentPlan'
export const quizPlan = {
  version: 3 as const,
  taskType: 'QUIZ_GENERATION' as const,
  sourceHash: 'source-hash',
  compilation: null,
  quiz: {
    intent: {
      title: '资料驱动验证自测',
      requirements: '',
      reason: '资料包含一个验证知识点，选择一题覆盖。',
      coveragePolicy: 'EVERY_CHAPTER',
      requestedQuestions: 'AUTO',
      focusChapterIds: [],
    },
    difficulty: 'MEDIUM',
    chapters: [
      {
        id: 'ch1',
        parentId: '',
        order: 0,
        title: '验证',
        origin: 'PARSED',
        ranges: [],
        itemIds: ['item-1'],
      },
    ],
    objectives: [
      {
        id: 'o1',
        primaryChapterId: 'ch1',
        title: '验证依据',
        cognition: '理解',
        questionTypes: ['SINGLE_CHOICE'],
        itemIds: ['item-1'],
        priority: 1,
        reason: '检验理解',
        relatedChapterIds: [],
      },
    ],
    quotas: [
      { chapterId: 'ch1', minimum: 1, maximum: 1, weight: 1, allocated: 1, reason: '章节最低覆盖' },
    ],
    slots: [
      {
        id: 'q1',
        primaryChapterId: 'ch1',
        objectiveId: 'o1',
        cognition: '理解',
        type: 'SINGLE_CHOICE',
        itemIds: ['item-1'],
        relatedChapterIds: [],
      },
    ],
    uncovered: [],
  },
  execution: { parts: [], packages: [], maximumPackages: 1024, maximumSplitDepth: 8 },
  counts: {
    questions: 1,
    chapters: 1,
    sections: 0,
    contentSlides: 0,
    sourceSlides: 0,
    totalSlides: 0,
  },
  requiredNodes: ['accepted_q1'],
  estimatedTurns: 4,
  estimatedAttempts: 6,
  estimatedOutputBytes: 2048,
}
export const contentPlan: ContentPlanSnapshot = {
  plan: quizPlan,
  planHash: 'a'.repeat(64),
  completedUnits: 1,
  completedChapters: 1,
  totalChapters: 1,
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
  coverageReport: [
    {
      id: 'ch1',
      kind: 'QUIZ_CHAPTER',
      available: 1,
      selected: 1,
      relatedIds: ['q1'],
      reason: '主要覆盖',
    },
  ],
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
    quiz: null,
    compilation: {
      directory: {
        title: '验证整编',
        audience: '初学者',
        requirements: '',
        reason: '保留验证步骤',
        chapters: [
          {
            id: 'ch1',
            parentId: '',
            title: '验证步骤',
            purpose: '检验理解',
            exclusions: [],
            resultDependencies: [],
            relatedChapterIds: [],
            terms: [],
          },
        ],
        terms: [],
      },
      knowledge: [
        {
          id: 'k1',
          relation: 'SINGLE',
          summary: '验证依据',
          sourceItemIds: ['item-1'],
          conditions: [],
        },
      ],
      sections: [
        {
          id: 'g1',
          chapterId: 'ch1',
          title: '验证依据',
          purpose: '检验理解',
          ownedKnowledgeIds: ['k1'],
          contextKnowledgeIds: [],
          outputBytes: 2048,
        },
      ],
    },
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
        parentId: '',
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
