<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { tasksApi } from '../api'
import {
  availableTaskActions,
  isTaskActive,
  isLearningTask,
  isRetiredTask,
  taskTypeLabels,
  taskErrorMessages,
} from '../model'
import { useKnownTasks } from '../store'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
import type { ContentPlanSnapshot } from '@/shared/api/contracts/contentPlan'
import ContentPlan from '../components/ContentPlan.vue'
import { positiveId } from '@/shared/lib/validation'
import { ApiError, errorMessage } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import { usePoll } from '@/shared/lib/usePoll'
import { downloadText, dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
import MarkdownView from '@/shared/ui/MarkdownView.vue'
import FeePanel from '@/features/fees/components/FeePanel.vue'
import TaskMedia from '../components/TaskMedia.vue'
import LearningResultView from '../components/LearningResult.vue'
import type { LearningResult } from '@/shared/api/contracts/learning'
import { usePageSignal } from '@/shared/lib/usePageSignal'
const requests = usePageSignal()
const learning = ref<LearningResult | null>(null)
const route = useRoute(),
  known = useKnownTasks(),
  task = ref<TaskSnapshot | null>(
    known.created?.taskId === Number(route.params.id) ? known.created : null,
  ),
  report = ref('')
const isMedia = computed(
  () => !!task.value && ['NOTES_PPT', 'NOTES_VIDEO'].includes(task.value.taskType),
)
const isLearning = computed(() => !!task.value && isLearningTask(task.value.taskType))
const retired = computed(() => !!task.value && isRetiredTask(task.value.taskType))
const actions = computed(() =>
  task.value ? availableTaskActions(task.value.taskType, task.value.status) : [],
)
const plan = ref<ContentPlanSnapshot | null>(null),
  planChecked = ref(false)
const { busy, error, notice, run } = useAction()
known.created = null
async function fetchTask(signal?: AbortSignal) {
  try {
    task.value = await tasksApi.get(positiveId(route.params.id), signal)
    if (!['SUCCEEDED', 'PARTIAL'].includes(task.value.status)) {
      learning.value = null
      report.value = ''
    }
    known.add(task.value.taskId)
    if (isLearning.value || task.value.taskType === 'NOTES_PPT') {
      plan.value = await tasksApi.contentPlan(task.value.taskId, signal)
      planChecked.value = true
    }
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      task.value = null
      report.value = ''
      learning.value = null
      plan.value = null
    }
    throw e
  }
}
const poll = usePoll(
  async (signal) => {
    await fetchTask(signal)
    return (
      !!task.value && isTaskActive(task.value.status) && task.value.progress?.pollAfterMillis !== 0
    )
  },
  (e) => {
    error.value = errorMessage(e)
  },
  () => task.value?.progress?.pollAfterMillis ?? 2500,
)
function readPlan() {
  void run(async () => {
    plan.value = null
    planChecked.value = false
    plan.value = await tasksApi.contentPlan(positiveId(route.params.id), requests.signal)
    planChecked.value = true
  })
}
function refresh() {
  void run(async () => {
    poll.stop()
    requests.renew()
    learning.value = null
    report.value = ''
    plan.value = null
    await fetchTask(requests.signal)
    if (task.value && isTaskActive(task.value.status)) poll.start()
  })
}
onMounted(refresh)
function action(value: 'pause' | 'resume' | 'cancel') {
  void run(async () => {
    if (!task.value) return
    if (value === 'resume' && retired.value) throw new Error(taskErrorMessages.WORKFLOW_RETIRED)
    poll.stop()
    const shownVersion = task.value.stateVersion
    await fetchTask(requests.signal)
    if (!task.value) return
    if (shownVersion !== task.value.stateVersion) {
      notice.value = '任务状态已变化，请核对当前状态后再操作。'
      if (isTaskActive(task.value.status)) poll.start()
      return
    }
    if (!actions.value.includes(value)) throw new Error('当前状态不允许该操作')
    try {
      task.value = await tasksApi.action(task.value.taskId, value, requests.signal)
    } catch (e) {
      await fetchTask(requests.signal)
      throw e
    } finally {
      if (task.value && isTaskActive(task.value.status)) poll.start()
    }
  })
}
function readReport(download = false) {
  void run(async () => {
    report.value = ''
    await fetchTask(requests.signal)
    if (
      !task.value ||
      !['SUCCEEDED', 'PARTIAL'].includes(task.value.status) ||
      task.value.artifactId === null
    )
      throw new Error('当前没有可读取的报告产物')
    try {
      const result = await tasksApi.artifact(task.value.artifactId, requests.signal)
      report.value = result
      if (download) downloadText(result, 'report-' + task.value.taskId + '.md', 'text/markdown')
    } catch (e) {
      report.value = ''
      learning.value = null
      if (e instanceof ApiError && e.status === 403) notice.value = '产物当前不可访问，已清理预览。'
      throw e
    }
  })
}
function readLearning() {
  void run(async () => {
    learning.value = null
    report.value = ''
    await fetchTask(requests.signal)
    if (!task.value || !isLearning.value || task.value.status !== 'SUCCEEDED')
      throw new Error('学习结果尚未发布，请核对任务状态。')
    learning.value = await tasksApi.result(task.value.taskId, requests.signal)
  })
}
function invalidateLearning(reason: unknown) {
  learning.value = null
  report.value = ''
  error.value = errorMessage(reason)
  notice.value = '来源当前不可访问或已变化，已清理学习结果，请重新核验。'
}
</script>
<template>
  <PageHeader
    eyebrow="LEARNING & MEDIA TASK"
    :title="(isMedia ? '媒体任务 #' : isLearning ? '学习任务 #' : '历史任务 #') + route.params.id"
    description="任务状态来自服务端；暂停、取消不保证中止已经发出的远程模型调用。"
    ><el-button :loading="busy" @click="refresh">刷新状态</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" /><template v-if="task"
    ><div class="panel">
      <div class="section-title">
        <h2>
          {{ taskTypeLabels[task.taskType] || task.taskType }}
        </h2>
        <StatusBadge :status="task.status" />
      </div>
      <div class="task-facts">
        <div>
          <span>{{ task.progress ? '已完成步骤' : '模型检查点' }}</span
          ><strong
            >{{ task.progress?.completedSteps ?? task.completedSteps
            }}<small v-if="task.progress"> / {{ task.progress.totalSteps }}</small></strong
          >
        </div>
        <div>
          <span>模型尝试</span><strong>{{ task.modelAttempts }}<small> 次</small></strong>
        </div>
        <div>
          <span>状态版本</span><strong>{{ task.stateVersion }}</strong>
        </div>
      </div>
      <p v-if="task.errorCode" class="inline-error">
        {{ taskErrorMessages[task.errorCode] || '任务未完成，请保留错误码排查。' }}（{{
          task.errorCode
        }}）
      </p>
      <el-alert
        v-if="retired"
        title="旧 FAQ／研究报告已停止创建与恢复，仅保留历史查询和合法产物下载。"
        type="info"
        :closable="false"
      />
      <el-alert
        v-if="task.status === 'PARTIAL'"
        title="报告仅完成部分覆盖，请阅读报告正文中的覆盖说明。"
        type="warning"
        :closable="false"
      />
      <template v-if="task.progress">
        <p>{{ task.progress.message }} · {{ task.progress.stage }}</p>
        <el-progress
          :percentage="
            isMedia && task.status !== 'SUCCEEDED'
              ? Math.min(99, task.progress.percent)
              : task.progress.percent
          "
        />
        <p v-if="!task.progress.workerEnabled" class="inline-error">
          后台 Worker 当前关闭，任务尚未开始。
        </p>
        <p v-else-if="task.progress.stage === 'WAITING_FOR_RECOVERY'" class="muted">
          等待后台恢复，当前没有有效执行租约。
        </p>
        <p class="muted small">
          有效后台执行：{{ task.progress.executionActive ? '是' : '否' }} · 累计执行
          {{ task.progress.elapsedExecutionSeconds }} 秒 · 最近心跳
          {{ dateTime(task.progress.lastHeartbeatAt) }}
        </p>
        <div
          v-for="step in task.progress.steps"
          :key="step.stepId"
          class="structure-row"
          :class="{ 'active-step': task.progress.currentSteps.includes(step.stepId) }"
        >
          <strong>{{ step.label }}</strong
          ><StatusBadge :status="step.status" /><span class="muted small"
            >开始 {{ dateTime(step.startedAt) }} · 完成 {{ dateTime(step.completedAt) }}</span
          ><span v-if="step.errorCode" class="inline-error">{{ step.errorCode }}</span>
        </div>
      </template>
      <p v-else class="muted small">该响应未提供步骤进度，不推算处理阶段或百分比。</p>
      <div class="toolbar">
        <el-button v-if="actions.includes('pause')" :disabled="busy" @click="action('pause')"
          >暂停</el-button
        ><el-button
          v-if="!retired && actions.includes('resume')"
          :disabled="busy"
          type="primary"
          @click="action('resume')"
          >{{ isMedia ? '恢复原媒体任务' : '恢复' }}</el-button
        ><el-popconfirm
          v-if="actions.includes('cancel')"
          title="确定取消这个任务？"
          @confirm="action('cancel')"
          ><template #reference
            ><el-button type="danger" plain :disabled="busy">取消任务</el-button></template
          ></el-popconfirm
        ><template v-if="isLearning && task.status === 'SUCCEEDED'"
          ><el-button type="primary" :loading="busy" @click="readLearning"
            >核验并查看学习结果</el-button
          ></template
        ><template
          v-if="
            !isMedia && ['SUCCEEDED', 'PARTIAL'].includes(task.status) && task.artifactId !== null
          "
          ><el-button v-if="!isLearning" type="primary" :loading="busy" @click="readReport()"
            >核验并预览报告</el-button
          ><el-button :disabled="busy" @click="readReport(true)">下载 Markdown</el-button></template
        ><RouterLink v-if="task.status === 'FAILED'" to="/tasks">明确重新创建任务 →</RouterLink>
      </div>
      <div v-if="poll.expired.value">
        <p class="muted">本次 30 分钟观察窗口已结束。</p>
        <el-button @click="poll.start">继续观察</el-button>
      </div>
      <p class="muted small">可复制当前页面地址保存任务 ID。关闭页面停止观察，不等于取消任务。</p>
      <p
        v-if="isMedia && ['FAILED', 'NEEDS_RECONCILIATION'].includes(task.status)"
        class="muted small"
      >
        恢复由后端核验原操作，不重置费用或期限；未知提交且无原操作 ID 时会拒绝恢复。
      </p>
    </div>
    <TaskMedia v-if="isMedia" :task="task" @changed="refresh" />
    <LearningResultView v-if="learning" :result="learning" @invalidated="invalidateLearning" />
    <FeePanel kind="tasks" :resource-id="task.taskId" />
    <section v-if="!isLearning" class="panel">
      <h3>阅读覆盖</h3>
      <p v-if="!task.coverage?.length" class="muted">
        尚未登记覆盖或为历史任务，不能据此认定全文已读。
      </p>
      <div
        v-for="coverage in task.coverage || []"
        :key="coverage.documentId + ':' + coverage.sectionId"
        class="structure-row"
      >
        <strong
          >文档 #{{ coverage.documentId }} · v{{ coverage.documentVersion }} · 代次
          {{ coverage.processingRevision }}</strong
        >
        <span
          >{{ coverage.complete ? '全文已交分页模型' : '覆盖未完成' }} ·
          {{ coverage.completedPages }} 页</span
        >
        <span class="mono small"
          >已读 [{{ coverage.readStartOffset }}, {{ coverage.readEndOffset }}) · 未读 [{{
            coverage.remainingStartOffset
          }}, {{ coverage.remainingEndOffset }}) · UTF-16</span
        >
      </div>
      <p class="muted small">阅读完成不代表回答效果评分通过。</p>
    </section>
    <section v-if="isLearning || task.taskType === 'NOTES_PPT'" class="panel">
      <div class="section-title">
        <h3>资料内容计划</h3>
        <el-button :loading="busy" @click="readPlan">查询计划</el-button>
      </div>
      <p v-if="planChecked && !plan" class="muted">内容计划尚未生成或接受（204），请稍后查询。</p>
      <ContentPlan v-if="plan" :snapshot="plan" />
    </section>
    <section v-if="report" class="panel">
      <span class="eyebrow">MARKDOWN REPORT</span>
      <p class="muted small">报告中的 [D…v…] 保留原始版本标识，不代表当前版本原文。</p>
      <MarkdownView :text="report" /></section
  ></template>
</template>
