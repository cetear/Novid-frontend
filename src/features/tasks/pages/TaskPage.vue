<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { tasksApi } from '../api'
import { taskActions, isTaskActive } from '../model'
import { useKnownTasks } from '../store'
import type { TaskSnapshot, TaskPlanSnapshot } from '@/shared/api/contracts/backend'
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
const route = useRoute(),
  known = useKnownTasks(),
  task = ref<TaskSnapshot | null>(
    known.created?.taskId === Number(route.params.id) ? known.created : null,
  ),
  report = ref('')
const isMedia = computed(
  () => !!task.value && ['NOTES_PPT', 'NOTES_VIDEO'].includes(task.value.taskType),
)
const plan = ref<TaskPlanSnapshot | null>(null),
  planChecked = ref(false)
const { busy, error, notice, run } = useAction()
known.created = null
async function fetchTask(signal?: AbortSignal) {
  try {
    task.value = await tasksApi.get(positiveId(route.params.id), signal)
    known.add(task.value.taskId)
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      task.value = null
      report.value = ''
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
    plan.value = await tasksApi.plan(positiveId(route.params.id))
    planChecked.value = true
  })
}
function refresh() {
  void run(async () => {
    poll.stop()
    await fetchTask()
    if (task.value && isTaskActive(task.value.status)) poll.start()
  })
}
onMounted(refresh)
function action(value: 'pause' | 'resume' | 'cancel') {
  void run(async () => {
    if (!task.value) return
    poll.stop()
    const shownVersion = task.value.stateVersion
    await fetchTask()
    if (!task.value) return
    if (shownVersion !== task.value.stateVersion) {
      notice.value = '任务状态已变化，请核对当前状态后再操作。'
      if (isTaskActive(task.value.status)) poll.start()
      return
    }
    if (!taskActions[task.value.status]?.includes(value)) throw new Error('当前状态不允许该操作')
    try {
      task.value = await tasksApi.action(task.value.taskId, value)
    } catch (e) {
      await fetchTask()
      throw e
    } finally {
      if (task.value && isTaskActive(task.value.status)) poll.start()
    }
  })
}
function readReport(download = false) {
  void run(async () => {
    report.value = ''
    await fetchTask()
    if (
      !task.value ||
      !['SUCCEEDED', 'PARTIAL'].includes(task.value.status) ||
      task.value.artifactId === null
    )
      throw new Error('当前没有可读取的报告产物')
    try {
      const result = await tasksApi.artifact(task.value.artifactId)
      report.value = result
      if (download) downloadText(result, 'report-' + task.value.taskId + '.md', 'text/markdown')
    } catch (e) {
      report.value = ''
      if (e instanceof ApiError && e.status === 403) notice.value = '产物当前不可访问，已清理预览。'
      throw e
    }
  })
}
</script>
<template>
  <PageHeader
    eyebrow="REPORT TASK"
    :title="(isMedia ? '媒体任务 #' : '报告任务 #') + route.params.id"
    description="任务状态来自服务端；暂停、取消不保证中止已经发出的远程模型调用。"
    ><el-button :loading="busy" @click="refresh">刷新状态</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" /><template v-if="task"
    ><div class="panel">
      <div class="section-title">
        <h2>
          {{
            task.taskType === 'FAQ'
              ? '常见问题 FAQ'
              : task.taskType === 'RESEARCH_REPORT'
                ? '研究报告'
                : task.taskType === 'NOTES_PPT'
                  ? '演示文稿'
                  : task.taskType === 'NOTES_VIDEO'
                    ? '教学视频'
                    : task.taskType
          }}
        </h2>
        <StatusBadge :status="task.status" />
      </div>
      <div class="task-facts">
        <div>
          <span>{{ task.progress ? '已完成步骤' : '模型检查点' }}</span
          ><strong
            >{{ task.progress?.completedSteps ?? task.completedSteps
            }}<small> / {{ task.progress?.totalSteps ?? 3 }}</small></strong
          >
        </div>
        <div>
          <span>模型尝试</span><strong>{{ task.modelAttempts }}<small> 次</small></strong>
        </div>
        <div>
          <span>状态版本</span><strong>{{ task.stateVersion }}</strong>
        </div>
      </div>
      <p v-if="task.errorCode" class="inline-error">错误码：{{ task.errorCode }}</p>
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
            ['SUCCEEDED', 'PARTIAL'].includes(task.status)
              ? task.progress.percent
              : Math.min(80, task.progress.percent)
          "
        />
        <p v-if="!task.progress.workerEnabled" class="inline-error">
          报告 Worker 当前关闭，任务尚未开始。
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
        <el-button
          v-if="taskActions[task.status]?.includes('pause')"
          :disabled="busy"
          @click="action('pause')"
          >暂停</el-button
        ><el-button
          v-if="taskActions[task.status]?.includes('resume')"
          :disabled="busy"
          type="primary"
          @click="action('resume')"
          >恢复</el-button
        ><el-popconfirm
          v-if="taskActions[task.status]?.includes('cancel')"
          title="确定取消这个任务？"
          @confirm="action('cancel')"
          ><template #reference
            ><el-button type="danger" plain :disabled="busy">取消任务</el-button></template
          ></el-popconfirm
        ><template
          v-if="
            !isMedia && ['SUCCEEDED', 'PARTIAL'].includes(task.status) && task.artifactId !== null
          "
          ><el-button type="primary" :loading="busy" @click="readReport()">核验并预览报告</el-button
          ><el-button :disabled="busy" @click="readReport(true)">下载 Markdown</el-button></template
        ><RouterLink v-if="task.status === 'FAILED'" to="/tasks">明确重新创建任务 →</RouterLink>
      </div>
      <div v-if="poll.expired.value">
        <p class="muted">本次 30 分钟观察窗口已结束。</p>
        <el-button @click="poll.start">继续观察</el-button>
      </div>
      <p class="muted small">可复制当前页面地址保存任务 ID。关闭页面停止观察，不等于取消任务。</p>
    </div>
    <TaskMedia v-if="isMedia" :task="task" @changed="refresh" />
    <FeePanel kind="tasks" :resource-id="task.taskId" />
    <section class="panel">
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
    <section v-if="!isMedia" class="panel">
      <div class="section-title">
        <h3>受限研究计划</h3>
        <el-button :loading="busy" @click="readPlan">查询计划</el-button>
      </div>
      <p v-if="planChecked && !plan" class="muted">暂无计划：固定流程或尚未生成（204）。</p>
      <template v-if="plan">
        <p class="muted small">
          {{ plan.plan.version }} · {{ plan.agentVersion }} · {{ plan.modelId }} · 计划哈希
          {{ plan.planHash }}
        </p>
        <div v-for="step in plan.plan.steps" :key="step.stepId" class="structure-row">
          <strong>{{ step.action }} · {{ step.agentId }}</strong>
          <p>{{ step.input.focus }}</p>
          <span class="muted small"
            >依赖：{{ step.dependsOn.join('、') || '无' }} · {{ step.qualityRequirement }}</span
          >
        </div>
        <p class="muted small">这是已保存的计划；实际执行关系请在运行检查中查看。</p>
      </template>
    </section>
    <section v-if="report" class="panel">
      <span class="eyebrow">MARKDOWN REPORT</span>
      <p class="muted small">报告中的 [D…v…] 保留原始版本标识，不代表当前版本原文。</p>
      <MarkdownView :text="report" /></section
  ></template>
</template>
