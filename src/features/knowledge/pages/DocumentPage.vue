<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/features/auth'
import { knowledgeApi } from '../api'
import { processingOutcome } from '../model'
import type {
  DocumentContent,
  SectionSnapshot,
  ChunkSnapshot,
  IngestionMetadata,
  SectionPage,
} from '@/shared/api/contracts/backend'
import { positiveId, validRange } from '@/shared/lib/validation'
import { ApiError, errorMessage } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import { usePoll } from '@/shared/lib/usePoll'
import { downloadText, dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
import FeePanel from '@/features/fees/components/FeePanel.vue'
const auth = useAuth(),
  route = useRoute(),
  router = useRouter(),
  content = ref<DocumentContent | null>(null)
const { busy, error, notice, run } = useAction()
const title = ref(''),
  text = ref(''),
  editing = ref(false),
  tab = ref('source'),
  textPage = ref(0)
const sections = ref<SectionSnapshot[]>([]),
  chunks = ref<ChunkSnapshot[]>([]),
  structurePage = ref(0),
  structureKind = ref<'sections' | 'chunks'>('sections')
const baseline = ref<{ version: number; revision: number } | null>(null)
const recoveringRevision = ref<number | null>(null)
const ingestion = ref<IngestionMetadata | null>(null),
  ingestionError = ref(''),
  sectionPage = ref<SectionPage | null>(null),
  sectionOpen = ref(false)
const recoverable = computed(
  () =>
    ingestion.value?.status === 'FAILED' &&
    ingestion.value.progress?.retryable &&
    ingestion.value.progress.unknownBatches === 0,
)
const owned = computed(() => content.value?.document.ownerUserId === auth.user?.id)
const ready = computed(
  () =>
    content.value?.document.ingestionStatus === 'READY' &&
    content.value.document.activeProcessingRevision !== null,
)
const sourceSlice = computed(
  () => content.value?.text.slice(textPage.value * 16000, (textPage.value + 1) * 16000) || '',
)
function assign(value: DocumentContent) {
  const old = content.value?.document,
    next = value.document
  if (
    old &&
    (old.documentVersion !== next.documentVersion ||
      old.activeProcessingRevision !== next.activeProcessingRevision)
  ) {
    textPage.value = 0
    sections.value = []
    chunks.value = []
    sectionPage.value = null
    sectionOpen.value = false
  }
  content.value = value
  if (!editing.value) {
    title.value = next.title
    text.value = value.text
  }
  if (baseline.value) {
    const outcome = processingOutcome(baseline.value, next)
    if (outcome !== 'waiting') {
      baseline.value = null
      notice.value =
        outcome === 'activated'
          ? '当前版本的新索引代次已激活。'
          : '正文版本已变化，已停止跟踪旧版本的重处理请求。'
    }
  }
}
function clearPrivateContent() {
  content.value = null
  text.value = ''
  title.value = ''
  textPage.value = 0
  sections.value = []
  chunks.value = []
  editing.value = false
  ingestion.value = null
  sectionPage.value = null
  sectionOpen.value = false
  baseline.value = null
  recoveringRevision.value = null
}
async function fetchDocument(signal?: AbortSignal) {
  try {
    const result = await knowledgeApi.document(positiveId(route.params.id), signal)
    assign(result)
    if (result.document.ownerUserId === auth.user?.id) {
      ingestion.value = null
      ingestionError.value = ''
      try {
        ingestion.value = await knowledgeApi.ingestion(result.document.id, signal)
        if (
          recoveringRevision.value !== null &&
          (ingestion.value.processingRevision !== recoveringRevision.value ||
            ingestion.value.status === 'READY')
        )
          recoveringRevision.value = null
        if (ingestion.value.status === 'FAILED' && recoveringRevision.value === null) {
          baseline.value = null
          notice.value = '最新处理代次失败，请核对错误与预算后选择恢复或新代次。'
        }
      } catch (e) {
        ingestionError.value = errorMessage(e)
        if (e instanceof ApiError && [401, 403].includes(e.status)) {
          clearPrivateContent()
          throw e
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
      clearPrivateContent()
    }
    throw e
  }
}
const poll = usePoll(
  async (signal) => {
    await fetchDocument(signal)
    return (
      !!baseline.value ||
      recoveringRevision.value !== null ||
      ['RECEIVED', 'PROCESSING'].includes(
        ingestion.value?.status ?? content.value?.document.ingestionStatus ?? '',
      )
    )
  },
  (e) => {
    error.value = errorMessage(e)
  },
)
function refresh() {
  void run(async () => {
    poll.stop()
    await fetchDocument()
    if (
      baseline.value ||
      recoveringRevision.value !== null ||
      ['RECEIVED', 'PROCESSING'].includes(
        ingestion.value?.status ?? content.value?.document.ingestionStatus ?? '',
      )
    )
      poll.start()
  })
}
onMounted(refresh)
function edit() {
  poll.stop()
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  if (content.value) {
    title.value = content.value.document.title
    text.value = content.value.text
  }
  refresh()
}
function save() {
  void run(async () => {
    if (!content.value || !owned.value) return
    try {
      await knowledgeApi.updateDocument(content.value, title.value, text.value)
      editing.value = false
      await fetchDocument()
      poll.start()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        editing.value = false
        await fetchDocument()
        notice.value = '版本已变化，已读取当前正文。请核对后再次编辑。'
      }
      throw e
    }
  })
}
function remove() {
  void run(async () => {
    if (!content.value || !owned.value) return
    const baseId = content.value.document.knowledgeBaseId
    try {
      await knowledgeApi.deleteDocument(
        content.value.document.id,
        content.value.document.documentVersion,
      )
      poll.stop()
      await router.push('/knowledge-bases/' + baseId)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await fetchDocument()
      throw e
    }
  })
}
function reprocess() {
  void run(async () => {
    if (!content.value || !owned.value) return
    poll.stop()
    recoveringRevision.value = null
    const d = content.value.document
    await knowledgeApi.index(d.id, d.ingestionStatus === 'FAILED' ? 'retry' : 'reprocess')
    baseline.value = { version: d.documentVersion, revision: d.activeProcessingRevision ?? 0 }
    notice.value = '已请求重处理，等待新代次。旧 READY 不代表本次处理已经完成。'
    poll.start()
  })
}
function recover() {
  void run(async () => {
    if (!owned.value || !ingestion.value) return
    poll.stop()
    const shown = ingestion.value
    await fetchDocument()
    if (
      !ingestion.value ||
      ingestion.value.processingRevision !== shown.processingRevision ||
      !recoverable.value
    )
      throw new Error('处理代次或恢复条件已变化，请核对当前状态')
    try {
      await knowledgeApi.recover(shown.documentId, shown.processingRevision)
      recoveringRevision.value = shown.processingRevision
      notice.value = '已提前调度原失败代次，尚未入库成功；额度与期限不重置。'
    } catch (e) {
      recoveringRevision.value = null
      throw e
    } finally {
      await fetchDocument()
    }
    poll.start()
  })
}
function readSection(sectionId: string, next = false) {
  void run(async () => {
    if (!content.value || !ready.value) throw new Error('当前版本目录尚未激活')
    const d = content.value.document,
      previous = sectionPage.value
    if (next && (!previous || previous.nextOffset === null)) return
    sectionPage.value = null
    try {
      const page = await knowledgeApi.section(
        d.id,
        sectionId,
        d.documentVersion,
        d.activeProcessingRevision!,
        next ? previous!.nextOffset! : undefined,
      )
      if (
        page.documentId !== d.id ||
        page.documentVersion !== d.documentVersion ||
        page.processingRevision !== d.activeProcessingRevision ||
        page.sectionId !== sectionId
      )
        throw new Error('章节响应版本不一致，请刷新目录')
      sectionPage.value = page
      sectionOpen.value = true
    } catch (e) {
      sectionOpen.value = false
      if (e instanceof ApiError && e.status === 409) {
        sections.value = []
        chunks.value = []
        await fetchDocument()
        notice.value = '章节版本或代次已变化，旧游标已清除，请重新加载目录。'
      }
      if (e instanceof ApiError && e.status === 403) {
        clearPrivateContent()
      }
      throw e
    }
  })
}
function download() {
  void run(async () => {
    if (!content.value) return
    const id = content.value.document.id
    try {
      const original = await knowledgeApi.source(id)
      downloadText(original, 'document-' + id + '.txt', 'text/plain')
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        clearPrivateContent()
      }
      throw e
    }
  })
}
function structure(n = 0) {
  void run(async () => {
    try {
      textPage.value = 0
      sections.value = []
      chunks.value = []
      if (!content.value || !ready.value) throw new Error('当前版本索引未就绪')
      structurePage.value = n
      const before = await knowledgeApi.document(content.value.document.id)
      const rows =
        structureKind.value === 'sections'
          ? await knowledgeApi.sections(before.document.id, n)
          : await knowledgeApi.chunks(before.document.id, n)
      const after = await knowledgeApi.document(before.document.id)
      if (
        before.document.documentVersion !== after.document.documentVersion ||
        before.document.activeProcessingRevision !== after.document.activeProcessingRevision
      ) {
        assign(after)
        throw new Error('读取期间版本或激活代次变化，请重新加载结构')
      }
      assign(after)
      if (structureKind.value === 'sections') sections.value = rows as SectionSnapshot[]
      else chunks.value = rows as ChunkSnapshot[]
    } catch (e) {
      if (e instanceof ApiError && [401, 403].includes(e.status)) clearPrivateContent()
      throw e
    }
  })
}
function parentMissing(section: SectionSnapshot) {
  return (
    section.parentSectionId && !sections.value.some((s) => s.sectionId === section.parentSectionId)
  )
}
function locate(start: number, end: number) {
  if (!content.value || !validRange(content.value.text, start, end)) {
    error.value = '原文范围无效'
    return
  }
  textPage.value = Math.floor(start / 16000)
  tab.value = 'source'
  notice.value = '已打开包含起点的原文片段；坐标为 UTF-16 [' + start + ', ' + end + ')。'
}
</script>
<template>
  <PageHeader
    eyebrow="DOCUMENT"
    :title="content?.document.title || '文档详情'"
    :description="
      content
        ? '文档 #' + content.document.id + ' · 当前内容版本 ' + content.document.documentVersion
        : '读取当前原文和索引状态。'
    "
    ><el-button :disabled="busy" @click="refresh">刷新</el-button
    ><el-button v-if="content" :disabled="busy" @click="download">下载原文</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" /><template v-if="content"
    ><div class="document-meta">
      <StatusBadge :status="content.document.ingestionStatus" /><span class="muted"
        >激活代次 {{ content.document.activeProcessingRevision ?? '尚无' }}</span
      ><RouterLink :to="'/knowledge-bases/' + content.document.knowledgeBaseId"
        >知识库 #{{ content.document.knowledgeBaseId }} ↗</RouterLink
      >
      <div v-if="owned" class="toolbar">
        <el-button
          :disabled="
            busy ||
            editing ||
            !['READY', 'RECEIVED', 'FAILED'].includes(content.document.ingestionStatus)
          "
          @click="edit"
          >修订正文</el-button
        ><el-popconfirm
          title="登记全新代次和预算，可能再次产生模型费用。确定继续？"
          @confirm="reprocess"
          ><template #reference
            ><el-button
              :disabled="
                busy ||
                !!baseline ||
                !['READY', 'RECEIVED', 'FAILED'].includes(content.document.ingestionStatus)
              "
              >重处理</el-button
            ></template
          ></el-popconfirm
        ><el-popconfirm title="删除该文档？此操作无法撤销。" @confirm="remove"
          ><template #reference
            ><el-button
              type="danger"
              plain
              :disabled="
                busy || !['READY', 'RECEIVED', 'FAILED'].includes(content.document.ingestionStatus)
              "
              >删除</el-button
            ></template
          ></el-popconfirm
        >
      </div>
    </div>
    <el-alert
      v-if="baseline"
      title="已请求重处理，正在等待新代次。"
      type="info"
      :closable="false"
    />
    <section v-if="owned" class="panel ingestion-panel">
      <h3>本人入库管理</h3>
      <Feedback :error="ingestionError" />
      <template v-if="ingestion">
        <p>
          最新代次 {{ ingestion.processingRevision }} · <StatusBadge :status="ingestion.status" /> ·
          已激活 {{ ingestion.activeProcessingRevision ?? '尚无' }}
        </p>
        <p v-if="ingestion.errorCode" class="inline-error">{{ ingestion.errorCode }}</p>
        <template v-if="ingestion.progress">
          <p>
            阶段 {{ ingestion.progress.phase }} · 失败阶段
            {{ ingestion.progress.failureStage ?? '无' }}
          </p>
          <p>
            批次：计划 {{ ingestion.progress.plannedBatches }} / 已嵌入
            {{ ingestion.progress.embeddedBatches }} / 已核验索引
            {{ ingestion.progress.indexedBatches }} / 结果未知
            {{ ingestion.progress.unknownBatches }}
          </p>
          <p class="muted small">
            领取 {{ ingestion.progress.claims }} 次 · 模型尝试
            {{ ingestion.progress.modelAttempts }} 次 · 截止
            {{ dateTime(ingestion.progress.deadline) }} · 下次尝试
            {{ dateTime(ingestion.progress.nextAttemptAt) }}
          </p>
          <p class="muted small">
            保守输入预留 {{ ingestion.progress.reservedInputTokens }} · 已知提供方输入
            {{ ingestion.progress.actualInputTokens }} · 用量未知尝试
            {{ ingestion.progress.unknownUsageAttempts }}。费用未知。
          </p>
          <p v-if="ingestion.progress.phase === 'LEGACY'" class="muted small">
            历史记录，没有逐批核验事实。
          </p>
          <el-button v-if="recoverable" :disabled="busy" @click="recover">提前恢复原代次</el-button>
        </template>
        <p v-else class="muted">该记录没有批次进度。</p>
        <p v-if="recoveringRevision !== null" class="muted small">
          已调度原代次，正在观察服务端状态；是否开始以返回事实为准。
        </p>
        <p class="muted small">
          只有最终核验并激活才算就绪；恢复不会新建代次，重处理会申请全新预算。
        </p>
      </template>
    </section>
    <p v-if="content.document.ingestionStatus === 'RECEIVED' || baseline" class="muted small">
      等待后台处理；长时间不变时请核对联调环境。前端只观察状态。
    </p>
    <div v-if="poll.expired.value" class="toolbar">
      <span>已达到 30 分钟观察窗口。</span><el-button @click="poll.start">继续观察</el-button>
    </div>
    <div v-if="editing && owned" class="panel">
      <el-form label-position="top" @submit.prevent="save"
        ><el-form-item label="标题"><el-input v-model="title" maxlength="200" /></el-form-item
        ><el-form-item label="正文"
          ><el-input v-model="text" type="textarea" :rows="18" /></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy">保存新版本</el-button
        ><el-button @click="cancelEdit">取消</el-button></el-form
      >
    </div>
    <div v-else class="panel">
      <el-tabs v-model="tab"
        ><el-tab-pane label="当前原文" name="source"
          ><p class="muted small">保留原始文本与坐标。每片段最多展示 16,000 个 UTF-16 单元。</p>
          <pre class="source-text">{{ sourceSlice }}</pre>
          <div class="page-stepper">
            <span class="muted">原文片段 {{ textPage + 1 }}</span>
            <div>
              <el-button :disabled="textPage === 0" @click="textPage--">上一片段</el-button
              ><el-button
                :disabled="(textPage + 1) * 16000 >= content.text.length"
                @click="textPage++"
                >下一片段</el-button
              >
            </div>
          </div></el-tab-pane
        ><el-tab-pane label="目录与小片" name="structure"
          ><div class="toolbar">
            <el-radio-group v-model="structureKind" @change="structure()"
              ><el-radio-button value="sections">目录</el-radio-button
              ><el-radio-button value="chunks">小片</el-radio-button></el-radio-group
            ><el-button :disabled="!ready" :loading="busy" @click="structure()"
              >加载当前结构</el-button
            >
          </div>
          <p class="muted small">
            仅展示当前结构页。父节点未加载时标为目录未完整，不推断完整目录。
          </p>
          <div v-if="structureKind === 'sections'">
            <div v-for="section in sections" :key="section.sectionId" class="structure-row">
              <strong>{{ section.headingPath }}</strong
              ><span class="mono small muted"
                >{{ section.sectionId }} · [{{ section.startOffset }},
                {{ section.endOffset }})</span
              ><span v-if="parentMissing(section)" class="inline-error small"
                >父节点未在本页加载 · 目录未完整</span
              ><span class="small muted"
                >层级 {{ section.ancestorSectionIds.length }} · 父节点
                {{ section.parentSectionId || '无' }}</span
              ><el-button text @click="locate(section.startOffset, section.endOffset)"
                >定位原文</el-button
              >
              <el-button text :disabled="busy" @click="readSection(section.sectionId)"
                >按章节续读</el-button
              >
            </div>
          </div>
          <div v-else>
            <details v-for="chunk in chunks" :key="chunk.chunkId" class="chunk-row">
              <summary>
                {{ chunk.chunkId }} · [{{ chunk.startOffset }}, {{ chunk.endOffset }})
              </summary>
              <p class="muted small">
                章节 {{ chunk.sectionId }} · 上下文父段 {{ chunk.contextParentId }} · 章节内序号
                {{ chunk.chunkIndexInSection }} · 父段内序号 {{ chunk.chunkIndexInParent }}
              </p>
              <p v-if="chunk.blockType" class="muted small">
                块类型 {{ chunk.blockType }} · 块 {{ chunk.blockId ?? '无' }} · 分段
                {{ chunk.partIndex }} · 计数 {{ chunk.tokenCount }}（{{ chunk.countSource }}）
              </p>
              <details v-if="chunk.sourceMap?.length">
                <summary>原文映射（UTF-16）</summary>
                <p v-for="(mapping, index) in chunk.sourceMap" :key="index" class="mono small">
                  嵌入 [{{ mapping.embeddingStartOffset }}, {{ mapping.embeddingEndOffset }}) → 原文
                  [{{ mapping.sourceStartOffset }}, {{ mapping.sourceEndOffset }}) · 行
                  {{ mapping.startLine }}–{{ mapping.endLine
                  }}{{ mapping.repeatedHeader ? ' · 重复表头' : '' }}
                </p>
              </details>
              <pre class="source-text">{{ chunk.rawText }}</pre>
              <details>
                <summary>嵌入文本</summary>
                <pre class="source-text">{{ chunk.embeddingText }}</pre>
              </details>
              <el-button text @click="locate(chunk.startOffset, chunk.endOffset)"
                >定位原文</el-button
              >
            </details>
          </div>
          <PageStepper
            :page="structurePage"
            :busy="busy"
            :count="structureKind === 'sections' ? sections.length : chunks.length"
            @change="structure" /></el-tab-pane
        ><el-tab-pane label="派生来源" name="dependencies"
          ><p v-if="!content.sourceDependencies.length" class="muted">该文档没有登记派生来源。</p>
          <p
            v-for="source in content.sourceDependencies"
            :key="source.documentId + ':' + source.documentVersion"
          >
            知识库 #{{ source.knowledgeBaseId }} / 文档 #{{ source.documentId }} / v{{
              source.documentVersion
            }}
          </p></el-tab-pane
        ></el-tabs
      >
    </div></template
  >
  <el-dialog v-model="sectionOpen" title="章节原文续读" width="min(900px, 96vw)">
    <template v-if="sectionPage"
      ><h3>{{ sectionPage.headingPath }}</h3>
      <p class="muted small">
        v{{ sectionPage.documentVersion }} · 代次 {{ sectionPage.processingRevision }} · UTF-16 [{{
          sectionPage.startOffset
        }}, {{ sectionPage.endOffset }}) · {{ sectionPage.tokenCount }}（{{
          sectionPage.countSource
        }}）
      </p>
      <pre class="source-text">{{ sectionPage.text }}</pre>
      <p>
        {{ sectionPage.complete ? '所选章节子树已读完' : '本章节尚有未读内容' }} · 未读 [{{
          sectionPage.remainingStartOffset
        }}, {{ sectionPage.remainingEndOffset }})
      </p>
      <el-button
        :disabled="busy || sectionPage.nextOffset === null"
        @click="readSection(sectionPage.sectionId, true)"
        >下一页章节原文</el-button
      ></template
    >
  </el-dialog>
  <FeePanel v-if="owned && ingestion" kind="ingestions" :resource-id="ingestion.ingestionId" />
</template>
