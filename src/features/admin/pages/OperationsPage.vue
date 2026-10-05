<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../api'
import { feesApi } from '@/features/fees/api'
import { useLoad } from '@/shared/lib/useLoad'
import { dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const days = ref(7),
  cursor = ref(0),
  cursors = ref<number[]>([])
const metrics = useLoad<Awaited<ReturnType<typeof adminApi.metrics>>>()
const fees = useLoad<Awaited<ReturnType<typeof feesApi.aggregate>>>()
const audit = useLoad<Awaited<ReturnType<typeof adminApi.audit>>>()
const metricLabels = {
  runs: '窗口内运行',
  failedRuns: '失败或取消运行',
  incompleteRuns: '不完整运行',
  queuedTasks: '当前排队任务',
  pendingOutbox: '当前消息积压',
  accessEvents: '窗口内访问记录',
  queryCacheHits: '本实例累计缓存命中',
  queryCacheMisses: '本实例累计缓存未命中',
  queryCacheEntries: '当前近似缓存键数',
}
function refreshMetrics() {
  void metrics.load((signal) => adminApi.metrics(days.value, signal))
  void fees.load((signal) => feesApi.aggregate(days.value, signal))
}
function readAudit() {
  void audit.load((signal) => adminApi.audit(cursor.value, signal))
}
function next() {
  const last = audit.data.value?.at(-1)
  if (last) {
    cursors.value.push(cursor.value)
    cursor.value = last.id
    readAudit()
  }
}
function previous() {
  cursor.value = cursors.value.pop() ?? 0
  readAudit()
}
onMounted(() => {
  refreshMetrics()
  readAudit()
})
</script>
<template>
  <PageHeader
    eyebrow="ADMIN / OPERATIONS"
    title="看见运行，核对访问。"
    description="管理计数、币种费用聚合与访问元数据。私人任务、会话和正文仍仅由本人读取。"
    ><div class="toolbar">
      <label
        >统计窗口
        <select v-model.number="days" aria-label="管理统计天数">
          <option :value="1">1 天</option>
          <option :value="7">7 天</option>
          <option :value="30">30 天</option>
        </select></label
      ><el-button :loading="metrics.loading.value || fees.loading.value" @click="refreshMetrics"
        >刷新指标</el-button
      >
    </div></PageHeader
  >
  <Feedback :error="metrics.loadError.value" /><el-skeleton
    v-if="metrics.loading.value"
    :rows="3"
    animated
  />
  <div v-if="metrics.data.value" class="metrics-grid">
    <div v-for="(label, key) in metricLabels" :key="key" class="stat-card">
      <span>{{ label }}</span
      ><strong>{{ metrics.data.value[key] }}</strong>
    </div>
  </div>
  <p class="muted small">
    失败计数含取消等非成功记录，不等于 HTTP
    错误率；缓存计数从本实例启动累计，重启归零。缓存命中仍可能发生模型费用。
  </p>
  <section class="panel">
    <div class="section-title">
      <h2>费用聚合</h2>
      <span class="muted small">最近 {{ days }} 天 · 按币种分别展示</span>
    </div>
    <Feedback :error="fees.loadError.value" /><el-table
      v-if="fees.data.value"
      :data="fees.data.value"
      ><el-table-column prop="currency" label="币种" /><el-table-column
        prop="estimatedAmount"
        label="已计价估算"
        min-width="150" /><el-table-column
        prop="reservedAmount"
        label="已报价预留"
        min-width="150" /><el-table-column
        prop="unknownAttempts"
        label="未知记录" /><el-table-column prop="pendingAttempts" label="待结算" /><el-table-column
        prop="simulatedAttempts"
        label="模拟"
    /></el-table>
    <p class="muted small">
      仅为窗口内已记录部分，未知费用不能视为零；已计价估算不是供应商实付账单。
    </p>
  </section>
  <section class="panel">
    <div class="section-title">
      <div>
        <span class="eyebrow">ACCESS AUDIT</span>
        <h2>可交付访问记录</h2>
      </div>
      <el-button :loading="audit.loading.value" @click="readAudit">刷新审计</el-button>
    </div>
    <Feedback :error="audit.loadError.value" /><el-table
      v-if="audit.data.value"
      :data="audit.data.value"
      row-key="id"
      ><el-table-column type="expand"
        ><template #default="{ row }"
          ><div class="audit-detail">
            <p>
              权限版本 {{ row.permissionVersion ?? '历史未知' }} · 内容纪元
              {{ row.knowledgeEpoch ?? '历史未知' }} · 所有者筛选
              {{ row.ownerUserId ?? '无或历史未知' }}
            </p>
            <p>库集合：{{ row.knowledgeBaseIds?.join('、') ?? '历史未知' }}</p>
            <p>对象集合：{{ row.resourceIds?.join('、') ?? '历史未知' }}</p>
          </div></template
        ></el-table-column
      ><el-table-column prop="id" label="ID" width="80" /><el-table-column
        prop="actorUserId"
        label="访问者 ID"
        width="110"
      /><el-table-column prop="action" label="动作" min-width="190" /><el-table-column
        prop="scopeMode"
        label="范围"
        width="100"
      /><el-table-column prop="resultCount" label="候选/结果数" width="120" /><el-table-column
        prop="outcome"
        label="交付状态"
        min-width="160"
      /><el-table-column label="时间" min-width="190"
        ><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column
      ></el-table
    >
    <div class="page-stepper">
      <span>游标 {{ cursor }} · 本页 {{ audit.data.value?.length ?? 0 }} 条</span>
      <div class="toolbar">
        <el-button :disabled="!cursors.length || audit.loading.value" @click="previous"
          >上一页</el-button
        ><el-button :disabled="!audit.data.value?.length || audit.loading.value" @click="next"
          >读取后续</el-button
        >
      </div>
    </div>
    <p class="muted small">
      DELIVERABLE
      表示服务端完成复核与审计，不能证明浏览器已收到。检索数量是候选片数；该表不是完整安全日志。
    </p>
  </section>
</template>
