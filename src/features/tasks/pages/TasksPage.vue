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
import { mediaApi } from '../mediaApi'
import type { QuizOptions, CompilationOptions } from '@/shared/api/contracts/learning'
import { ApiError } from '@/shared/api/errors'
import type {
  TaskType,
  CatalogItem,
  VideoCapability,
  PresentationOptions,
  VideoOptions,
} from '@/shared/api/contracts/media'
const auth = useAuth(),
  scope = useKnowledgeScope(),
  known = useKnownTasks(),
  router = useRouter()
const topic = ref(''),
  remarks = ref(''),
  taskType = ref<TaskType>('QUIZ_GENERATION'),
  selected = ref<number[]>([]),
  page = ref(0),
  knownId = ref('')
const mediaTask = computed(() => ['NOTES_PPT', 'NOTES_VIDEO'].includes(taskType.value))
const strategy = computed(() =>
  taskType.value === 'NOTES_VIDEO' ? ('PLANNED' as const) : ('FIXED' as const),
)
const quiz = ref<QuizOptions>({
  questionCount: 0,
  questionTypes: ['SINGLE_CHOICE', 'SHORT_ANSWER'],
  difficulty: 'MEDIUM',
})
const compilation = ref<CompilationOptions>({ detailLevel: 'DETAILED', maximumChapters: 0 })
const presentation = ref<PresentationOptions>({
  pageCount: 0,
  themeId: 'default',
  maximumAmount: '30',
  imagePolicy: 'MIXED',
})
const video = ref<VideoOptions>({
  characterId: '',
  voiceId: '',
  sceneId: '',
  seconds: 15,
  maximumAmount: '20',
  shotCount: 3,
  burnSubtitles: false,
})
const {
  data: catalogData,
  loading: catalogsLoading,
  loadError: catalogsError,
  load: loadCatalogs,
} = useLoad<{ catalogs: CatalogItem[]; capabilities: VideoCapability[] }>()
function catalogs(kind: string) {
  return catalogData.value?.catalogs.filter((item) => item.enabled && item.kind === kind) ?? []
}
const { data: documents, loading, loadError, load } = useLoad<DocumentSnapshot[]>(),
  { busy, error, run } = useAction()
const key = ref(crypto.randomUUID()),
  uncertain = ref(false)
const fingerprint = computed(() =>
  JSON.stringify({
    instructions: taskType.value === 'NOTES_VIDEO' ? topic.value : remarks.value,
    taskType: taskType.value,
    strategy: strategy.value,
    scope: scope.scope,
    ids: selected.value,
    learning:
      taskType.value === 'QUIZ_GENERATION'
        ? quiz.value
        : taskType.value === 'KNOWLEDGE_COMPILATION'
          ? compilation.value
          : null,
    media:
      taskType.value === 'NOTES_PPT'
        ? presentation.value
        : taskType.value === 'NOTES_VIDEO'
          ? video.value
          : null,
  }),
)
watch(taskType, (value) => {
  if (value === 'NOTES_VIDEO')
    void loadCatalogs(async (signal) => {
      const [catalogs, capabilities] = await Promise.all([
        mediaApi.catalogs(signal),
        mediaApi.capabilities(signal),
      ])
      return { catalogs, capabilities }
    })
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
        taskType.value === 'NOTES_VIDEO' ? topic.value : remarks.value,
        frozen,
        [...selected.value],
        key.value,
        strategy.value,
        taskType.value === 'NOTES_PPT'
          ? { presentationOptions: { ...presentation.value } }
          : taskType.value === 'NOTES_VIDEO'
            ? { videoOptions: { ...video.value } }
            : taskType.value === 'QUIZ_GENERATION'
              ? { quizOptions: { ...quiz.value, questionTypes: [...quiz.value.questionTypes] } }
              : { compilationOptions: { ...compilation.value } },
      )
      known.add(task.taskId)
      known.created = task
      uncertain.value = false
      await router.push('/tasks/' + task.taskId)
    } catch (e) {
      uncertain.value = !(e instanceof ApiError && e.status >= 400 && e.status < 500)
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
    eyebrow="LEARN & CREATE"
    title="让资料，成为知识。"
    description="从授权资料出发，生成学习自测、整编复习文档，或制作演示文稿与教学视频。"
  /><ScopePicker :admin="auth.user?.role === 'ADMIN'" /><Feedback :error="error || loadError" />
  <div class="task-create-grid">
    <section class="panel">
      <span class="eyebrow">01 / CREATE</span>
      <h2>{{ mediaTask ? '创建媒体任务' : '创建学习任务' }}</h2>
      <el-form label-position="top" @submit.prevent="create"
        ><el-form-item label="输出类型"
          ><el-radio-group v-model="taskType" :disabled="busy"
            ><el-radio-button value="QUIZ_GENERATION">学习自测</el-radio-button
            ><el-radio-button value="KNOWLEDGE_COMPILATION">资料整编</el-radio-button
            ><el-radio-button value="NOTES_PPT">演示文稿</el-radio-button
            ><el-radio-button value="NOTES_VIDEO">教学视频</el-radio-button></el-radio-group
          ></el-form-item
        >
        <template v-if="taskType === 'QUIZ_GENERATION'">
          <el-form-item label="题目数量"
            ><el-input-number
              v-model="quiz.questionCount"
              :min="0"
              :max="512"
              :precision="0"
              :disabled="busy"
              aria-label="题目数量"
          /></el-form-item>
          <p class="muted small">
            0 表示根据资料自动规划；1～512 表示精确题数。备注也可提出数量要求。
          </p>
          <el-form-item label="允许题型"
            ><el-checkbox-group v-model="quiz.questionTypes" :disabled="busy"
              ><el-checkbox value="SINGLE_CHOICE">单选题</el-checkbox
              ><el-checkbox value="SHORT_ANSWER">简答题</el-checkbox></el-checkbox-group
            ></el-form-item
          >
          <el-form-item label="难度"
            ><el-select v-model="quiz.difficulty" :disabled="busy" aria-label="难度"
              ><el-option label="简单" value="EASY" /><el-option
                label="中等"
                value="MEDIUM" /><el-option label="困难" value="HARD" /></el-select
          ></el-form-item>
        </template>
        <template v-if="taskType === 'KNOWLEDGE_COMPILATION'">
          <el-form-item label="整编详略"
            ><el-select v-model="compilation.detailLevel" :disabled="busy" aria-label="整编详略"
              ><el-option label="简洁" value="CONCISE" /><el-option
                label="详细"
                value="DETAILED" /></el-select
          ></el-form-item>
          <el-form-item label="章节上限"
            ><el-input-number
              v-model="compilation.maximumChapters"
              :min="0"
              :max="512"
              :precision="0"
              :disabled="busy"
              aria-label="章节上限"
          /></el-form-item>
          <p class="muted small">0 表示自动规划；1～512 设置章节上限，实际章节数由资料决定。</p>
        </template>
        <div v-if="mediaTask" class="media-options">
          <el-alert
            title="先规划并核对，再批准生成。真实媒体质量仍需本人验收。"
            type="info"
            :closable="false"
          />
          <template v-if="taskType === 'NOTES_PPT'">
            <el-form-item label="总页数（包含来源页）"
              ><el-input-number
                v-model="presentation.pageCount"
                :min="0"
                :max="512"
                :precision="0"
                :disabled="busy"
                aria-label="演示文稿总页数"
            /></el-form-item>
            <p class="muted small">
              0 表示自动规划；指定总页数为 2～512，包含动态来源页。批准前可查看内容页与来源页数量。
            </p>
            <el-form-item label="配图策略"
              ><el-select v-model="presentation.imagePolicy" :disabled="busy"
                ><el-option label="混合配图" value="MIXED" /><el-option
                  label="概念图"
                  value="CONCEPT" /><el-option
                  label="事实图（需核验来源）"
                  value="FACTUAL" /></el-select
            ></el-form-item>
            <el-form-item label="费用上限（元，最大 30）"
              ><el-input
                v-model="presentation.maximumAmount"
                inputmode="decimal"
                :disabled="busy"
                aria-label="PPT 费用上限"
            /></el-form-item>
          </template>
          <template v-else>
            <Feedback :error="catalogsError" /><el-skeleton
              v-if="catalogsLoading"
              :rows="2"
              animated
            />
            <el-form-item
              v-for="field in [
                ['characterId', 'CHARACTER', '教学人物'],
                ['voiceId', 'VOICE', '原生声音'],
                ['sceneId', 'SCENE', '视觉场景'],
              ] as const"
              :key="field[0]"
              :label="field[2]"
              ><el-select
                v-model="video[field[0]]"
                :disabled="busy || catalogsLoading"
                :aria-label="field[2]"
                placeholder="选择服务端登记项"
                ><el-option
                  v-for="item in catalogs(field[1])"
                  :key="item.id"
                  :label="item.label + ' · v' + item.version"
                  :value="item.id" /></el-select
            ></el-form-item>
            <p v-if="catalogData && !catalogData.capabilities.length" class="inline-error">
              服务端暂无已登记视频能力，当前不能创建视频任务。
            </p>
            <div class="form-pair">
              <el-form-item label="镜头数"
                ><el-input-number
                  v-model="video.shotCount"
                  :min="1"
                  :max="6"
                  :precision="0"
                  :disabled="busy"
                  aria-label="镜头数" /></el-form-item
              ><el-form-item label="目标总时长（秒）"
                ><el-input-number
                  v-model="video.seconds"
                  :min="1"
                  :max="90"
                  :precision="0"
                  :disabled="busy"
                  aria-label="目标总时长"
              /></el-form-item>
            </div>
            <el-form-item label="费用上限（元，最大 30）"
              ><el-input
                v-model="video.maximumAmount"
                inputmode="decimal"
                :disabled="busy"
                aria-label="视频费用上限"
            /></el-form-item>
            <el-checkbox v-model="video.burnSubtitles" :disabled="busy"
              >将字幕烧录到视频画面（同时保留独立 SRT）</el-checkbox
            >
            <p class="muted small">
              整部视频使用一个 API 及配置版本；有声与无声规格在脚本预览中核对。
            </p>
          </template>
        </div>
        <el-form-item v-if="taskType === 'NOTES_VIDEO'" label="主题" for="report-topic"
          ><el-input
            id="report-topic"
            v-model="topic"
            :disabled="busy"
            type="textarea"
            :rows="4"
            maxlength="1000"
            placeholder="描述需要整理的主题和重点…"
        /></el-form-item>
        <el-form-item v-else label="备注（可选）" for="task-remarks">
          <el-input
            id="task-remarks"
            v-model="remarks"
            :disabled="busy"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            placeholder="可填写受众、重点、数量或结构要求；留空由资料决定。"
          />
        </el-form-item>
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
          失败。资料任务原文容量由服务端策略决定，默认合计最多 1,000,000 UTF-8
          字节；超限需缩小范围。
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
          :disabled="
            !selected.length ||
            (taskType === 'NOTES_VIDEO' && !topic.trim()) ||
            (taskType === 'NOTES_PPT' && presentation.pageCount === 1) ||
            (taskType === 'QUIZ_GENERATION' && !quiz.questionTypes.length) ||
            (taskType === 'NOTES_VIDEO' &&
              (!video.characterId ||
                !video.voiceId ||
                !video.sceneId ||
                !catalogData?.capabilities.length))
          "
          class="full-width"
          >{{
            uncertain ? '使用原幂等键重新确认' : mediaTask ? '创建媒体任务 →' : '创建学习任务 →'
          }}</el-button
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
            ><span>任务 #{{ id }}</span
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
        <p>
          学习结果只有后台发布后才能读取。旧 FAQ／研究报告可通过已知 ID
          查询历史记录，已停止创建与恢复。
        </p>
      </div>
    </aside>
  </div>
</template>
