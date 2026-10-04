<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/features/auth'
import { ScopePicker, useKnowledgeScope, knowledgeApi } from '@/features/knowledge'
import { tasksApi } from '../api'
import { useKnownTasks } from '../store'
import { positiveId } from '@/shared/lib/validation'
import type { DocumentSnapshot } from '@/shared/api/contracts/backend'
import { useLoad } from '@/shared/lib/useLoad'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const auth = useAuth(),
  scope = useKnowledgeScope(),
  known = useKnownTasks(),
  router = useRouter()
const topic = ref(''),
  taskType = ref<'FAQ' | 'RESEARCH_REPORT'>('RESEARCH_REPORT'),
  strategy = ref<'FIXED' | 'PLANNED'>('FIXED'),
  selected = ref<number[]>([]),
  page = ref(0),
  knownId = ref('')
const { data: documents, loading, loadError, load } = useLoad<DocumentSnapshot[]>(),
  { busy, error, run } = useAction()
const key = ref(crypto.randomUUID()),
  uncertain = ref(false)
const fingerprint = computed(() =>
  JSON.stringify({
    topic: topic.value,
    taskType: taskType.value,
    strategy: strategy.value,
    scope: scope.scope,
    ids: selected.value,
  }),
)
watch(taskType, (value) => {
  if (value === 'FAQ') strategy.value = 'FIXED'
})
watch(
  fingerprint,
  () => {
    key.value = crypto.randomUUID()
    uncertain.value = false
  },
  { flush: 'sync' },
)
function fetchDocuments(n = 0) {
  page.value = n
  const frozen = { ...scope.scope, knowledgeBaseIds: [...scope.scope.knowledgeBaseIds] }
  void load((signal) => knowledgeApi.documents(frozen, n, signal))
}
watch(
  () => scope.revision,
  () => {
    selected.value = []
    fetchDocuments(0)
  },
  { immediate: true },
)
function create() {
  void run(async () => {
    const frozen = { ...scope.scope, knowledgeBaseIds: [...scope.scope.knowledgeBaseIds] }
    try {
      const task = await tasksApi.create(
        taskType.value,
        topic.value,
        frozen,
        [...selected.value],
        key.value,
        strategy.value,
      )
      known.add(task.taskId)
      known.created = task
      uncertain.value = false
      await router.push('/tasks/' + task.taskId)
    } catch (e) {
      uncertain.value = true
      throw e
    }
  })
}
function open() {
  void run(async () => {
    await router.push('/tasks/' + positiveId(knownId.value))
  })
}
</script>
<template>
  <PageHeader
    eyebrow="FROM SOURCES TO REPORTS"
    title="让资料，形成观点。"
    description="选择 1～6 份授权文档，生成 FAQ 或研究报告。执行前需有就绪的目录索引。"
  /><ScopePicker :admin="auth.user?.role === 'ADMIN'" /><Feedback :error="error || loadError" />
  <div class="task-create-grid">
    <section class="panel">
      <h2>创建报告</h2>
      <el-form label-position="top" @submit.prevent="create"
        ><el-form-item label="报告类型"
          ><el-radio-group v-model="taskType" :disabled="busy"
            ><el-radio-button value="RESEARCH_REPORT">研究报告</el-radio-button
            ><el-radio-button value="FAQ">常见问题 FAQ</el-radio-button></el-radio-group
          ></el-form-item
        ><el-form-item v-if="taskType === 'RESEARCH_REPORT'" label="执行策略">
          <el-radio-group v-model="strategy" :disabled="busy">
            <el-radio-button value="FIXED">固定流程</el-radio-button>
            <el-radio-button value="PLANNED">受限研究计划</el-radio-button>
          </el-radio-group> </el-form-item
        ><el-form-item label="主题" for="report-topic"
          ><el-input
            id="report-topic"
            v-model="topic"
            :disabled="busy"
            type="textarea"
            :rows="4"
            maxlength="1000"
            placeholder="描述需要整理的主题和重点…"
        /></el-form-item>
        <div class="section-title">
          <h3>来源文档</h3>
          <span class="muted small">已选 {{ selected.length }}/6</span>
        </div>
        <el-checkbox-group v-model="selected" class="document-choices" :disabled="busy"
          ><div v-for="document in documents || []" :key="document.id" class="document-choice">
            <el-checkbox
              :value="document.id"
              :aria-label="'选择文档 ' + document.title"
              :disabled="selected.length >= 6 && !selected.includes(document.id)"
            />
            <div>
              <strong>{{ document.title }}</strong
              ><small class="muted">#{{ document.id }} · v{{ document.documentVersion }}</small>
            </div>
            <StatusBadge :status="document.ingestionStatus" /></div
        ></el-checkbox-group>
        <p v-if="!loading && !documents?.length" class="muted">
          本页没有文档，可继续翻页或调整范围。
        </p>
        <PageStepper
          :page="page"
          :count="documents?.length"
          :busy="loading || busy"
          @change="fetchDocuments"
        />
        <p v-if="selected.length" class="small muted">
          选中文档 ID：{{ selected.join(', ') }}（可跨当前分页）
        </p>
        <p class="muted small">
          未 READY 或没有激活代次的文档可以登记任务，但执行会因 INDEX_NOT_READY
          失败。长文可能仅完成部分覆盖。
        </p>
        <el-alert
          v-if="uncertain"
          title="上次请求未确认成功。参数保持相同时，可使用原幂等键手动重试。"
          type="warning"
          :closable="false"
        /><el-button
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="!selected.length || !topic.trim()"
          class="full-width"
          >{{ uncertain ? '使用原幂等键重新确认' : '创建报告任务 →' }}</el-button
        ></el-form
      >
    </section>
    <aside>
      <section class="panel">
        <span class="eyebrow">KNOWN IN THIS SESSION</span>
        <h2>本页已知任务</h2>
        <p class="muted small">
          仅登记本次登录取得的任务 ID，最多 100 条。刷新或退出后清除，不代表完整服务端任务列表。
        </p>
        <div v-if="known.ids.length" class="known-task-list">
          <RouterLink v-for="id in known.ids" :key="id" :to="'/tasks/' + id"
            ><span>报告任务 #{{ id }}</span
            ><span>查看 →</span></RouterLink
          >
        </div>
        <el-empty v-else description="本次登录暂无任务登记" :image-size="80" />
      </section>
      <section class="panel">
        <h3>打开已知任务</h3>
        <div class="toolbar">
          <el-input v-model="knownId" aria-label="已知任务 ID" placeholder="任务 ID" /><el-button
            @click="open"
            >打开</el-button
          >
        </div>
        <p class="muted small">登录后根据服务端权限重新读取。</p>
      </section>
      <div class="quiet-note">
        <strong>资料先行，结果有据。</strong>
        <p>报告只有后台完成后才能读取。长时间等待时，请核对后端处理环境。</p>
      </div>
    </aside>
  </div>
</template>
