<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/features/auth'
import { knowledgeApi } from '../api'
import { useKnowledgeScope } from '../store'
import type { KnowledgeBaseSnapshot, DocumentSnapshot } from '@/shared/api/contracts/backend'
import { positiveId } from '@/shared/lib/validation'
import { ApiError } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const auth = useAuth(),
  route = useRoute(),
  router = useRouter(),
  scope = useKnowledgeScope()
const base = ref<KnowledgeBaseSnapshot | null>(null),
  documents = ref<DocumentSnapshot[]>([]),
  page = ref(0),
  name = ref(''),
  description = ref('')
const knownDocumentId = ref(''),
  knownDocumentVersion = ref('')
const editing = ref(false),
  file = ref<File | null>(null),
  uploadKey = ref(''),
  uploadUnknown = ref(false)
const { busy, error, notice, run } = useAction()
const owned = computed(() => base.value?.ownerUserId === auth.user?.id)
async function fetchBase() {
  base.value = null
  documents.value = []
  base.value = await knowledgeApi.base(positiveId(route.params.id))
  name.value = base.value.name
  description.value = base.value.description
  if (base.value.enabled) await fetchDocuments()
}
async function fetchDocuments(n = page.value) {
  page.value = n
  documents.value = []
  if (base.value?.enabled)
    documents.value = await knowledgeApi.documents(
      { mode: 'SELECTED', knowledgeBaseIds: [base.value.id], ownerUserId: null },
      n,
    )
}
function reload() {
  void run(fetchBase)
}
onMounted(reload)
function save(enabled = base.value?.enabled ?? true) {
  void run(async () => {
    if (!base.value || !owned.value) return
    if (!enabled) scope.rememberDisabled(base.value.id)
    try {
      base.value = await knowledgeApi.updateBase(base.value, name.value, description.value, enabled)
      editing.value = false
      documents.value = []
      if (enabled) await fetchDocuments()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await fetchBase()
        notice.value = '已重新读取当前版本，请核对后重新修改。'
      }
      throw e
    }
  })
}
function remove() {
  void run(async () => {
    if (!base.value || !owned.value) return
    try {
      await knowledgeApi.deleteBase(base.value)
      await router.push('/knowledge-bases')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await fetchBase()
      throw e
    }
  })
}
function removeKnownDocument() {
  void run(async () => {
    if (!owned.value || base.value?.enabled) return
    await knowledgeApi.deleteDocument(
      positiveId(knownDocumentId.value),
      positiveId(knownDocumentVersion.value),
    )
    knownDocumentId.value = ''
    knownDocumentVersion.value = ''
    notice.value = '已删除指定文档。'
  })
}
function pick(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null
  uploadKey.value = crypto.randomUUID()
  uploadUnknown.value = false
}
function upload() {
  void run(async () => {
    if (!file.value || !base.value || !owned.value || !base.value.enabled)
      throw new Error('请选择本人启用库和文件')
    try {
      const document = await knowledgeApi.upload(file.value, base.value.id, uploadKey.value)
      file.value = null
      uploadUnknown.value = false
      await router.push('/documents/' + document.id)
    } catch (e) {
      uploadUnknown.value = !(e instanceof ApiError) || e.status === 0
      throw e
    }
  })
}
</script>
<template>
  <PageHeader
    eyebrow="KNOWLEDGE BASE"
    :title="base?.name || '知识库详情'"
    :description="
      base ? '知识库 #' + base.id + ' · 版本 ' + base.version : '重新读取当前知识库元信息。'
    "
    ><el-button :loading="busy" @click="reload">刷新</el-button
    ><el-button v-if="owned" @click="editing = !editing">编辑信息</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" /><template v-if="base"
    ><el-alert
      v-if="!base.enabled"
      :title="'知识库已禁用。请保留 ID #' + base.id + ' 或当前页面链接以便恢复。'"
      type="warning"
      :closable="false"
    />
    <div class="panel base-info">
      <p>{{ base.description || '尚未填写描述' }}</p>
      <span class="muted small">{{
        owned ? '本人所有' : '用户 #' + base.ownerUserId + ' 所有 · 仅可读取'
      }}</span>
      <div v-if="owned" class="toolbar">
        <el-button v-if="!base.enabled" type="primary" :disabled="busy" @click="save(true)"
          >重新启用</el-button
        ><el-popconfirm
          v-else
          :title="'禁用后列表隐藏，请保留 ID #' + base.id + '。确定禁用？'"
          @confirm="save(false)"
          ><template #reference
            ><el-button :disabled="busy">禁用知识库</el-button></template
          ></el-popconfirm
        ><el-popconfirm title="删除知识库及其资料？此操作无法撤销。" @confirm="remove"
          ><template #reference
            ><el-button type="danger" plain :disabled="busy">删除知识库</el-button></template
          ></el-popconfirm
        >
      </div>
    </div>
    <div v-if="editing && owned" class="panel">
      <el-form label-position="top" @submit.prevent="save()"
        ><el-form-item label="名称"><el-input v-model="name" maxlength="200" /></el-form-item
        ><el-form-item label="描述"
          ><el-input
            v-model="description"
            type="textarea"
            :rows="3"
            maxlength="2000" /></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy"
          >保存修改</el-button
        ></el-form
      >
    </div>
    <section v-if="owned && !base.enabled" class="panel">
      <h3>删除已知的本人文档</h3>
      <p class="muted small">
        禁用库无法重新读取文档列表。若已持有文档 ID 和内容版本，可提交版本检查删除。
      </p>
      <div class="toolbar">
        <el-input
          v-model="knownDocumentId"
          aria-label="待删除文档 ID"
          placeholder="已知文档 ID"
        /><el-input
          v-model="knownDocumentVersion"
          aria-label="待删除文档版本"
          placeholder="已知 documentVersion"
        /><el-popconfirm title="确认按这些 ID 与版本删除本人文档？" @confirm="removeKnownDocument"
          ><template #reference
            ><el-button
              type="danger"
              plain
              :disabled="busy || !knownDocumentId || !knownDocumentVersion"
              >删除已知文档</el-button
            ></template
          ></el-popconfirm
        >
      </div>
    </section>
    <template v-if="base.enabled"
      ><div v-if="owned" class="upload-panel">
        <div>
          <h3>添加一份新资料</h3>
          <p class="muted small">UTF-8 TXT / Markdown · 最多 10 MiB</p>
        </div>
        <label class="file-picker"
          ><input
            type="file"
            accept=".txt,.md,.markdown"
            aria-label="上传文档文件"
            @change="pick"
          /><span>{{ file?.name || '选择文件' }}</span></label
        ><el-button type="primary" :loading="busy" :disabled="!file" @click="upload">{{
          uploadUnknown ? '使用原幂等键重试' : '上传资料'
        }}</el-button>
      </div>
      <p v-if="uploadUnknown" class="muted small">
        未确认上次上传结果。文件和目标未变化时，本次重试使用相同幂等键。
      </p>
      <div class="section-title">
        <h2>库内文档</h2>
        <span class="muted small">本页结果不代表全部文档</span>
      </div>
      <el-table :data="documents" v-loading="busy"
        ><el-table-column label="标题" min-width="220"
          ><template #default="{ row }"
            ><RouterLink :to="'/documents/' + row.id">{{ row.title }}</RouterLink></template
          ></el-table-column
        ><el-table-column label="状态" width="120"
          ><template #default="{ row }"
            ><StatusBadge :status="row.ingestionStatus" /></template></el-table-column
        ><el-table-column prop="documentVersion" label="内容版本" width="100" /><el-table-column
          prop="activeProcessingRevision"
          label="激活代次"
          width="100" /></el-table
      ><PageStepper
        :page="page"
        :count="documents.length"
        :busy="busy"
        @change="run(() => fetchDocuments($event))"
      />
      <p class="muted small">短页或空页仍可继续翻页；后端没有精确总页数。</p></template
    ></template
  >
</template>
