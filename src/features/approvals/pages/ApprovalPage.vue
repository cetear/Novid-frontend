<script setup lang="ts">
import { ref, onMounted, onScopeDispose, computed } from 'vue'
import { useRoute } from 'vue-router'
import { approvalsApi } from '../api'
import type { ApprovalSnapshot } from '@/shared/api/contracts/backend'
import { ApiError } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import { dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import MarkdownView from '@/shared/ui/MarkdownView.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const route = useRoute(),
  approval = ref<ApprovalSnapshot | null>(null),
  now = ref(Date.now())
const { busy, error, notice, run } = useAction()
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onScopeDispose(() => {
  clearInterval(timer)
  approval.value = null
})
const expired = computed(() =>
  approval.value ? Date.parse(approval.value.expiresAt) <= now.value : false,
)
const remaining = computed(() =>
  approval.value
    ? Math.max(0, Math.ceil((Date.parse(approval.value.expiresAt) - now.value) / 60000))
    : 0,
)
async function fetchApproval() {
  try {
    approval.value = await approvalsApi.get(String(route.params.approvalId))
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) approval.value = null
    throw e
  }
}
function refresh() {
  void run(async () => {
    approval.value = null
    await fetchApproval()
  })
}
onMounted(refresh)
function decide(approved: boolean) {
  void run(async () => {
    if (!approval.value) return
    const shown = JSON.stringify(approval.value)
    await fetchApproval()
    if (!approval.value) return
    if (JSON.stringify(approval.value) !== shown) {
      notice.value = '确认记录已变化，请核对最新内容后再操作。'
      return
    }
    if (approval.value.status !== 'WAITING' || expired.value)
      throw new Error('当前记录不可决定，请重新准备笔记')
    try {
      approval.value = await approvalsApi.decide(approval.value.approvalId, approved)
    } catch (e) {
      try {
        await fetchApproval()
      } catch {
        approval.value = null
      }
      throw e
    }
  })
}
</script>
<template>
  <PageHeader
    eyebrow="REVIEW BEFORE SAVING"
    title="把答案，沉淀为笔记。"
    description="请完整核对内容、目标知识库和来源，批准后才会创建文档。"
    ><el-button :loading="busy" @click="refresh">重新核验</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" /><template v-if="approval"
    ><div class="approval-summary panel">
      <StatusBadge :status="approval.status" /><span class="mono small muted">{{
        approval.approvalId
      }}</span>
      <h2>{{ approval.title }}</h2>
      <p class="muted">
        目标知识库 #{{ approval.knowledgeBaseId }} · 库版本 {{ approval.targetVersion }}
      </p>
      <p class="muted small">
        到期 {{ dateTime(approval.expiresAt) }}
        <span v-if="approval.status === 'WAITING'"
          >· {{ expired ? '已到期，需重新准备' : '约剩 ' + remaining + ' 分钟' }}</span
        >
      </p>
      <el-alert
        v-if="approval.status === 'APPROVED' && approval.documentId !== null"
        title="笔记已保存为文档；索引仍需后台处理。"
        type="success"
        :closable="false"
      /><RouterLink
        v-if="approval.status === 'APPROVED' && approval.documentId !== null"
        :to="'/documents/' + approval.documentId"
        >打开文档 #{{ approval.documentId }} →</RouterLink
      >
      <p v-else-if="approval.status === 'APPROVED'" class="inline-error">
        记录已批准但没有文档 ID，尚不能确认保存成功。
      </p>
    </div>
    <section class="panel">
      <span class="eyebrow">FULL PREVIEW</span><MarkdownView :text="approval.content" />
    </section>
    <section class="panel">
      <h2>全部来源依赖</h2>
      <p class="muted small">以下是服务端展开后的完整来源；批准时将再次核验。</p>
      <el-table :data="approval.sourceDependencies"
        ><el-table-column prop="knowledgeBaseId" label="知识库 ID" /><el-table-column
          prop="documentId"
          label="文档 ID" /><el-table-column prop="documentVersion" label="内容版本"
      /></el-table>
    </section>
    <div v-if="approval.status === 'WAITING'" class="approval-actions">
      <el-button :disabled="busy || expired" @click="decide(false)">拒绝保存</el-button
      ><el-button type="primary" :loading="busy" :disabled="expired" @click="decide(true)"
        >已核对，批准保存</el-button
      >
    </div>
    <p v-if="expired && approval.status === 'WAITING'" class="muted">
      确认已到期，后端状态仍可能为 WAITING。请回到问答页面重新准备。
    </p></template
  >
</template>
