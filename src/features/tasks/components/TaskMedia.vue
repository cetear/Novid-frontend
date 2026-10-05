<script setup lang="ts">
import { computed, ref, watch, onScopeDispose } from 'vue'
import { mediaApi, PPT_MIME } from '../mediaApi'
import { tasksApi } from '../api'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
import type { MediaUnit, VideoRecommendation } from '@/shared/api/contracts/media'
import { useLoad } from '@/shared/lib/useLoad'
import { useAction } from '@/shared/lib/useAction'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import { dateTime } from '@/shared/lib/format'
import { ApiError } from '@/shared/api/errors'
import Feedback from '@/shared/ui/Feedback.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const props = defineProps<{ task: TaskSnapshot }>(),
  emit = defineEmits<{ changed: [] }>()
const requests = usePageSignal(),
  { busy, error, notice, run: perform } = useAction()
const { data, loading, loadError, load } = useLoad<{
  preview: Awaited<ReturnType<typeof mediaApi.preview>>
  presentation: Awaited<ReturnType<typeof mediaApi.presentation>>
  operations: Awaited<ReturnType<typeof mediaApi.operations>>
}>()
const isPpt = computed(() => props.task.taskType === 'NOTES_PPT')
const editing = ref(false),
  units = ref<MediaUnit[]>([]),
  reviewNote = ref('')
const pageUrls = ref<Record<number, string>>({}),
  videoUrl = ref('')
const plans = ref<Awaited<ReturnType<typeof mediaApi.plans>>>([])
const progress = ref<Awaited<ReturnType<typeof mediaApi.progress>> | null>(null)
const capabilities = ref<Awaited<ReturnType<typeof mediaApi.capabilities>>>([])
const profileId = ref(''),
  resolution = ref(''),
  audioMode = ref<'NATIVE' | 'NONE'>('NATIVE'),
  seconds = ref(5)
const profile = computed(() => capabilities.value.find((c) => c.id === profileId.value))
const editable = computed(
  () =>
    !!data.value?.preview &&
    data.value.preview.previewVersion < 10 &&
    ['WAITING', 'APPROVED'].includes(data.value.preview.status) &&
    (['WAITING_APPROVAL', 'FAILED', 'NEEDS_RECONCILIATION', 'PAUSED'].includes(props.task.status) ||
      (isPpt.value &&
        ['MEDIA_READY', 'WAITING_MEDIA_REVIEW', 'SUCCEEDED'].includes(props.task.status))) &&
    !data.value.operations.some((op) =>
      ['SENDING', 'UNKNOWN', 'WAITING_EXTERNAL'].includes(op.state),
    ),
)
const approvalReady = computed(
  () =>
    props.task.status === 'WAITING_APPROVAL' &&
    data.value?.preview?.approvalId &&
    data.value.preview.expiresAt &&
    Date.parse(data.value.preview.expiresAt) > Date.now(),
)
function clearFiles() {
  Object.values(pageUrls.value).forEach(URL.revokeObjectURL)
  pageUrls.value = {}
  if (videoUrl.value) URL.revokeObjectURL(videoUrl.value)
  videoUrl.value = ''
}
function refresh() {
  requests.renew()
  clearFiles()
  plans.value = []
  progress.value = null
  capabilities.value = []
  void load(async (signal) => {
    const [preview, operations] = await Promise.all([
      mediaApi.preview(props.task.taskId, signal),
      mediaApi.operations(props.task.taskId, signal),
    ])
    const presentation =
      isPpt.value && preview ? await mediaApi.presentation(props.task.taskId, signal) : null
    if (presentation && presentation.check.previewVersion !== preview?.previewVersion)
      throw new Error('检查版本已变化，请重新核对预览')
    return { preview, operations, presentation }
  })
}
function run(action: () => Promise<void>) {
  return perform(async () => {
    try {
      await action()
    } catch (e) {
      if (
        e instanceof ApiError &&
        ([401, 403].includes(e.status) || ['PREVIEW_CHANGED', 'APPROVAL_EXPIRED'].includes(e.code))
      ) {
        clearFiles()
        data.value = null
        plans.value = []
        progress.value = null
        units.value = []
        editing.value = false
      }
      throw e
    }
  })
}
watch(() => [props.task.taskId, props.task.stateVersion], refresh, { immediate: true })
onScopeDispose(clearFiles)
async function currentPreview() {
  const signal = requests.signal,
    shown = data.value?.preview
  const [task, latest] = await Promise.all([
    tasksApi.get(props.task.taskId, signal),
    mediaApi.preview(props.task.taskId, signal),
  ])
  if (
    !latest ||
    latest.previewVersion !== shown?.previewVersion ||
    task.stateVersion !== props.task.stateVersion
  ) {
    refresh()
    emit('changed')
    throw new Error('任务或预览已变化，请核对最新版本后再操作')
  }
  return { task, preview: latest }
}
function decide(approved: boolean) {
  void run(async () => {
    const { task, preview } = await currentPreview()
    if (task.status !== 'WAITING_APPROVAL' || !preview.approvalId)
      throw new Error('当前版本没有待处理审批')
    await mediaApi.decide(preview.approvalId, task.taskId, approved, requests.signal)
    refresh()
    emit('changed')
  })
}
function edit() {
  units.value =
    data.value?.preview?.units.map((u) => ({ ...u, references: [...u.references] })) ?? []
  editing.value = true
}
function save() {
  void run(async () => {
    const { preview } = await currentPreview()
    await mediaApi.edit(props.task.taskId, preview.previewVersion, units.value, requests.signal)
    editing.value = false
    refresh()
    emit('changed')
    notice.value = '预览已更新，旧批准失效，请重新核对并审批。'
  })
}
function selectVideo() {
  void run(async () => {
    const { preview } = await currentPreview(),
      selected = profile.value
    if (
      !selected ||
      !selected.prices[resolution.value] ||
      !selected.durations.includes(seconds.value) ||
      !selected.audioModes.includes(audioMode.value)
    )
      throw new Error('请选用已登记、支持参数且有价格的配置')
    if (!preview.storyboard) throw new Error('尚无分镜')
    if (audioMode.value === 'NONE' && preview.storyboard.shots.some((s) => s.narration.trim()))
      throw new Error('无声模式不能保留台词，请核对脚本')
    const shots: VideoRecommendation[] = preview.storyboard.shots.map((s) => ({
      shotId: s.shotId,
      profileId: selected.id,
      resolution: resolution.value,
      audioMode: audioMode.value,
      seconds: seconds.value,
      reason: '本人选择整片统一 API 与音频规格',
    }))
    await mediaApi.selection(props.task.taskId, preview.previewVersion, shots, requests.signal)
    refresh()
    emit('changed')
    notice.value = '整片选择已保存为新预览，须重新审批。'
  })
}
function review(accepted: boolean) {
  void run(async () => {
    const { task, preview } = await currentPreview()
    if (task.status !== 'WAITING_MEDIA_REVIEW') throw new Error('任务当前尚未进入本人验收')
    await mediaApi.review(
      task.taskId,
      preview.previewVersion,
      accepted,
      reviewNote.value,
      requests.signal,
    )
    reviewNote.value = ''
    refresh()
    emit('changed')
  })
}
function exportPpt() {
  void run(async () => {
    const { task, preview } = await currentPreview()
    if (!['MEDIA_READY', 'FAILED', 'PAUSED'].includes(task.status))
      throw new Error('当前状态不允许旧素材本地导出')
    await mediaApi.exportPresentation(task.taskId, preview.previewVersion, requests.signal)
    refresh()
    emit('changed')
    notice.value = '已登记本地导出，请观察原任务；原期限与预算继续有效。'
  })
}
async function checkedArtifact(id: number, mime: string, checksum?: string) {
  const signal = requests.signal
  const result = await mediaApi.artifact(id, mime, signal)
  if (checksum && result.checksum !== checksum)
    throw new Error('附件校验值与当前检查不一致，请刷新')
  if (checksum) {
    const bytes = await result.blob.arrayBuffer(),
      hash = await crypto.subtle.digest('SHA-256', bytes)
    const actual = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
    if (actual !== checksum.toLowerCase()) throw new Error('附件内容校验失败，请重新核对')
  }
  if (signal.aborted) throw new DOMException('页面已停止读取', 'AbortError')
  return result.blob
}
function download(
  id: number,
  mime: string,
  filename: string,
  checksum?: string,
  showVideo = false,
) {
  clearFiles()
  void run(async () => {
    const blob = await checkedArtifact(id, mime, checksum),
      url = URL.createObjectURL(blob)
    if (showVideo) {
      videoUrl.value = url
      return
    }
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}
function showPage(number: number) {
  clearFiles()
  void run(async () => {
    const page = data.value?.presentation?.pages.find((p) => p.number === number)
    if (!page?.artifactId) throw new Error('该页尚无登记附件')
    pageUrls.value = {
      [number]: URL.createObjectURL(
        await checkedArtifact(page.artifactId, 'image/png', page.preview.checksum),
      ),
    }
  })
}
function inspect(kind: 'plans' | 'progress' | 'capabilities') {
  void run(async () => {
    if (kind === 'plans') plans.value = await mediaApi.plans(props.task.taskId, requests.signal)
    if (kind === 'progress')
      progress.value = await mediaApi.progress(props.task.taskId, requests.signal)
    if (kind === 'capabilities') capabilities.value = await mediaApi.capabilities(requests.signal)
  })
}
</script>
<template>
  <section class="panel media-workbench">
    <div class="section-title">
      <div>
        <span class="eyebrow">{{ isPpt ? 'PRESENTATION STUDIO' : 'VIDEO STUDIO' }}</span>
        <h2>{{ isPpt ? '演示文稿工作区' : '分镜视频工作区' }}</h2>
      </div>
      <el-button :loading="loading" @click="refresh">核对当前预览</el-button>
    </div>
    <Feedback :error="error || loadError" :notice="notice" /><el-skeleton
      v-if="loading"
      :rows="3"
      animated
    />
    <el-alert
      v-if="task.status === 'NEEDS_RECONCILIATION'"
      title="外部结果待核对。请保留原操作与预留，不能重新购买或自动更换 API。"
      type="warning"
      :closable="false"
    />
    <p v-if="!loading && !data?.preview" class="muted">
      当前尚无可读取预览。请等待规划并刷新核对。
    </p>
    <template v-if="data?.preview">
      <div class="preview-banner">
        <div>
          <strong>预览 v{{ data.preview.previewVersion }}</strong>
          <p class="muted small">
            计划 v{{ data.preview.planVersion }} · {{ data.preview.qualityStatus }} · 有效至
            {{ dateTime(data.preview.expiresAt) }}
          </p>
        </div>
        <div>
          <span>估算 / 上限 · {{ data.preview.currency }}</span
          ><strong
            >{{ data.preview.estimatedAmount ?? '待重新核价' }} /
            {{ data.preview.maximumAmount }}</strong
          >
        </div>
      </div>
      <div class="unit-grid">
        <article
          v-for="(unit, index) in data.preview.units"
          :key="unit.unitId"
          class="preview-unit"
        >
          <span class="eyebrow">{{ String(index + 1).padStart(2, '0') }} · {{ unit.layout }}</span>
          <h3>{{ unit.title }}</h3>
          <p class="preserve-text">{{ unit.text }}</p>
          <details>
            <summary>备注与配图要求</summary>
            <p>{{ unit.notes || '无备注' }}</p>
            <p>{{ unit.imageMode }} · {{ unit.imagePrompt || '无配图提示' }}</p>
            <p class="muted small">来源标签：{{ unit.references.join('、') || '无' }}</p>
          </details>
        </article>
      </div>
      <div v-if="data.preview.storyboard" class="storyboard-list">
        <h3>逐镜头脚本与 API 快照</h3>
        <article
          v-for="shot in data.preview.storyboard.shots"
          :key="shot.shotId"
          class="structure-row"
        >
          <strong>{{ shot.shotId }} · {{ shot.narration || '无台词' }}</strong>
          <p>{{ shot.visualPrompt }}</p>
          <p class="muted small">{{ shot.motionPrompt }}</p>
          <span v-if="shot.video"
            >{{ shot.video.capability.model }} · {{ shot.video.capability.id }} v{{
              shot.video.capability.version
            }}
            · {{ shot.video.resolution }} ·
            {{
              shot.video.audioMode === 'NATIVE'
                ? '原生有声'
                : shot.video.audioMode === 'NONE'
                  ? '无声'
                  : shot.video.audioMode
            }}
            · {{ shot.video.seconds }} 秒</span
          ><span v-else>无已批准 API 快照</span>
        </article>
      </div>
      <details class="source-review">
        <summary>来源、覆盖与登记项（审批前请核对）</summary>
        <p v-for="source in data.preview.sourceDependencies" :key="source.documentId">
          <RouterLink :to="'/documents/' + source.documentId"
            >文档 #{{ source.documentId }}</RouterLink
          >
          · v{{ source.documentVersion }} · 库 #{{ source.knowledgeBaseId }}
        </p>
        <p
          v-for="coverage in data.preview.coverage"
          :key="coverage.documentId + coverage.sectionId"
          class="small"
        >
          #{{ coverage.documentId }} · {{ coverage.complete ? '覆盖完成' : '覆盖未完成' }} · 已读
          [{{ coverage.readStartOffset }}, {{ coverage.readEndOffset }}) / 未读 [{{
            coverage.remainingStartOffset
          }}, {{ coverage.remainingEndOffset }})
        </p>
        <p v-for="item in data.preview.catalogs" :key="item.id">
          {{ item.kind }} · {{ item.label }} · v{{ item.version }} · {{ item.mappingKind }}
        </p>
        <p class="muted small">
          人物与声音提示映射不保证一致外观、音色或口型，最终须本人听看验收。
        </p>
      </details>
      <div class="toolbar">
        <el-button :disabled="busy || !editable" @click="edit">编辑内容并重新审批</el-button
        ><template v-if="approvalReady"
          ><el-popconfirm
            title="已核对当前脚本、来源与费用上限，并批准付费生成？"
            @confirm="decide(true)"
            ><template #reference
              ><el-button type="primary" :disabled="busy">批准当前版本与费用</el-button></template
            ></el-popconfirm
          ><el-button :disabled="busy" @click="decide(false)">拒绝本次批准</el-button></template
        ><span v-else class="muted small">当前无有效待审批版本</span>
      </div>
      <details v-if="!isPpt" class="source-review">
        <summary>整片 API 与声音规格</summary>
        <el-button :loading="busy" @click="inspect('capabilities')">读取登记能力</el-button>
        <form
          v-if="capabilities.length"
          class="toolbar selection-form"
          @submit.prevent="selectVideo"
        >
          <label
            >整片 API
            <select v-model="profileId" aria-label="整片 API">
              <option value="">选择配置</option>
              <option v-for="cap in capabilities" :key="cap.id" :value="cap.id">
                {{ cap.model }} · v{{ cap.version }} · {{ cap.verificationStatus }}
              </option>
            </select></label
          ><label
            >分辨率
            <select v-model="resolution" aria-label="分辨率">
              <option value="">请选择</option>
              <option
                v-for="r in profile?.resolutions"
                :key="r"
                :value="r"
                :disabled="!profile?.prices[r]"
              >
                {{ r }}{{ !profile?.prices[r] ? '（缺价）' : '' }}
              </option>
            </select></label
          ><label
            >声音
            <select v-model="audioMode" aria-label="声音">
              <option
                v-for="mode in profile?.audioModes.filter((m) => ['NATIVE', 'NONE'].includes(m))"
                :key="mode"
                :value="mode"
              >
                {{ mode === 'NATIVE' ? '原生有声' : '无声' }}
              </option>
            </select></label
          ><label
            >每镜头秒数
            <select v-model.number="seconds" aria-label="每镜头秒数">
              <option v-for="s in profile?.durations" :key="s" :value="s">{{ s }}</option>
            </select></label
          ><el-button native-type="submit" :disabled="busy || !profile || !editable"
            >保存选择并重新审批</el-button
          >
        </form>
      </details>
      <div v-if="data.presentation" class="presentation-check">
        <div class="section-title">
          <h3>页面检查与候选交付</h3>
          <StatusBadge :status="data.presentation.check.structuralStatus" />
        </div>
        <p>
          {{ data.presentation.check.slideCount }} 页 · {{ data.presentation.check.font }} ·
          {{ data.presentation.check.layoutVersion }}
        </p>
        <el-alert
          :title="
            task.status === 'SUCCEEDED'
              ? '本人已接受当前产物；自动检查事实仍保留为待人工复核。'
              : '结构检查不替代本人图文质量验收。当前候选尚未视为完成。'
          "
          type="info"
          :closable="false"
        />
        <p v-for="warning in data.presentation.check.warnings" :key="warning" class="inline-error">
          {{ warning }}
        </p>
        <div class="page-preview-grid">
          <article v-for="page in data.presentation.pages" :key="page.number" class="page-preview">
            <img
              v-if="pageUrls[page.number]"
              :src="pageUrls[page.number]"
              :alt="'演示文稿第 ' + page.number + ' 页检查预览'"
            />
            <div v-else class="page-placeholder">{{ String(page.number).padStart(2, '0') }}</div>
            <el-button :disabled="busy || !page.artifactId" @click="showPage(page.number)"
              >核验第 {{ page.number }} 页</el-button
            >
          </article>
        </div>
        <el-button
          v-if="data.presentation.artifactId"
          type="primary"
          :disabled="busy"
          @click="
            download(
              data.presentation.artifactId,
              PPT_MIME,
              'presentation-' + task.taskId + '.pptx',
              data.presentation.pptx.checksum,
            )
          "
          >下载{{ task.status === 'SUCCEEDED' ? '正式' : '候选' }} PPTX</el-button
        >
        <details class="source-review">
          <summary>配图来源与原操作</summary>
          <p v-for="image in data.presentation.check.images" :key="image.assetId">
            {{ image.unitId }} · {{ image.kind }} · {{ image.operationId
            }}<span v-if="image.source">
              · {{ image.source.sourcePageUrl }} · {{ image.source.author || '作者未知' }} ·
              {{ image.source.license || '使用信息未知' }} ·
              {{ dateTime(image.source.retrievedAt) }}</span
            >
          </p>
        </details>
      </div>
      <el-button
        v-if="isPpt && ['MEDIA_READY', 'FAILED', 'PAUSED'].includes(task.status)"
        :disabled="busy"
        @click="exportPpt"
        >申请原素材本地导出</el-button
      >
      <template
        v-if="
          !isPpt && ['WAITING_MEDIA_REVIEW', 'SUCCEEDED'].includes(task.status) && task.artifactId
        "
        ><div class="toolbar">
          <el-button
            :disabled="busy"
            @click="
              download(
                task.artifactId,
                'video/mp4',
                'video-' + task.taskId + '.mp4',
                undefined,
                true,
              )
            "
            >核验并播放{{ task.status === 'SUCCEEDED' ? '正式' : '候选' }}视频</el-button
          ><el-button
            :disabled="busy"
            @click="download(task.artifactId, 'video/mp4', 'video-' + task.taskId + '.mp4')"
            >下载 MP4</el-button
          >
        </div>
        <video v-if="videoUrl" :src="videoUrl" controls preload="metadata" class="private-video">
          <track kind="captions" /></video
      ></template>
      <div
        v-if="
          data.preview.assets.some((a) => a.artifactId && a.file?.mime === 'application/x-subrip')
        "
        class="toolbar"
      >
        <template v-for="asset in data.preview.assets" :key="asset.assetId"
          ><el-button
            v-if="asset.artifactId && asset.file?.mime === 'application/x-subrip'"
            :disabled="busy"
            @click="
              download(
                asset.artifactId,
                asset.file.mime,
                'subtitles-' + task.taskId + '.srt',
                asset.file.checksum,
              )
            "
            >下载独立字幕</el-button
          ></template
        >
      </div>
      <section v-if="task.status === 'WAITING_MEDIA_REVIEW'" class="human-review">
        <h3>本人质量验收</h3>
        <p class="muted">请检查页面、图文来源，或听看完整视频的台词、音轨与风格。</p>
        <el-input
          v-model="reviewNote"
          type="textarea"
          aria-label="本人验收说明"
          placeholder="记录实际检查结果，接受与拒绝都需要说明"
          maxlength="2000"
          :rows="3"
        />
        <div class="toolbar">
          <el-button type="primary" :disabled="busy || !reviewNote.trim()" @click="review(true)"
            >已检查，接受产物</el-button
          ><el-button
            type="danger"
            plain
            :disabled="busy || !reviewNote.trim()"
            @click="review(false)"
            >拒绝并保留记录</el-button
          >
        </div>
      </section>
    </template>
    <details class="source-review">
      <summary>媒体操作与实际计划</summary>
      <div class="toolbar">
        <el-button :disabled="busy" @click="inspect('plans')">读取实际计划</el-button
        ><el-button v-if="!isPpt" :disabled="busy" @click="inspect('progress')"
          >读取实测时间轴</el-button
        >
      </div>
      <p class="muted small">页面刷新只读本地持久状态，不触发外部查询或购买。</p>
      <article v-for="op in data?.operations" :key="op.operationId" class="structure-row">
        <strong>{{ op.unitId }} · {{ op.capability }}</strong
        ><StatusBadge :status="op.state" /><span class="mono small"
          >原提供方 ID：{{ op.providerJobId || '未知' }}</span
        ><span class="small"
          >原查询 {{ op.pollCount }} 次 · 最近 {{ dateTime(op.lastPollAt) }} · 下次
          {{ dateTime(op.nextPollAt) }} · 费用 {{ op.costStatus }}</span
        ><span v-if="op.errorCode" class="inline-error">{{ op.errorCode }}</span>
      </article>
      <article v-for="plan in plans" :key="plan.hash">
        <h3>计划 v{{ plan.plan.planVersion }}</h3>
        <p v-for="step in plan.plan.steps" :key="step.stepId">
          {{ step.action }} · {{ step.agentId }} · 依赖 {{ step.dependsOn.join('、') || '无' }} ·
          {{ step.completionCondition }}
        </p>
      </article>
      <template v-if="progress"
        ><p>
          完成 {{ progress.completedShots }}/{{ progress.totalShots }} 镜头 ·
          {{ progress.renderPhase }} · {{ progress.waitReason || '无等待原因' }}
        </p>
        <p v-for="shot in progress.shots" :key="shot.shotId">
          {{ shot.shotId }} · 音轨
          {{
            shot.audioDurationMs === null
              ? '未测'
              : shot.audioDurationMs === 0
                ? '确认无音轨'
                : shot.audioDurationMs + ' ms'
          }}
          · 视频 {{ shot.providerDurationSeconds ?? '未测' }} 秒 · 时间轴
          {{ shot.timelineStartMs ?? '未知' }} — {{ shot.timelineEndMs ?? '未知' }} ms
        </p></template
      >
    </details>
  </section>
  <el-dialog
    v-model="editing"
    title="编辑当前预览"
    width="min(760px, 94vw)"
    :close-on-click-modal="false"
    ><Feedback :error="error" />
    <p class="muted small">修改后旧批准与附件立即失效，保留原累计期限与预算；需要重新审批。</p>
    <el-form label-position="top" @submit.prevent="save"
      ><fieldset v-for="unit in units" :key="unit.unitId" class="unit-editor">
        <legend>{{ unit.unitId }} · {{ unit.layout }}</legend>
        <el-form-item label="标题"><el-input v-model="unit.title" maxlength="200" /></el-form-item
        ><el-form-item label="正文 / 台词"
          ><el-input
            v-model="unit.text"
            type="textarea"
            :rows="4"
            :maxlength="isPpt ? 3000 : 2048" /></el-form-item
        ><el-form-item label="讲者备注"
          ><el-input
            v-model="unit.notes"
            type="textarea"
            :rows="2"
            maxlength="1500" /></el-form-item
        ><el-form-item label="配图提示"
          ><el-input
            v-model="unit.imagePrompt"
            maxlength="1000"
            :readonly="unit.imageMode === 'WEB_SEARCH'"
        /></el-form-item>
      </fieldset>
      <div class="toolbar">
        <el-button @click="editing = false">返回</el-button
        ><el-button native-type="submit" type="primary" :loading="busy">保存新版预览</el-button>
      </div></el-form
    ></el-dialog
  >
</template>
