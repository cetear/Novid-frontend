<script setup lang="ts">
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { runsApi } from '../api'
import type { TraceGraph } from '@/shared/api/contracts/backend'
import RunGraph from '../components/RunGraph.vue'
import { useLoad } from '@/shared/lib/useLoad'
import { dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const route = useRoute(),
  { data, loading, loadError, load } = useLoad<TraceGraph>()
function refresh() {
  void load((signal) => runsApi.graph(String(route.params.traceId), signal))
}
watch(() => route.params.traceId, refresh, { immediate: true })
</script>
<template>
  <PageHeader
    eyebrow="RUN DETAIL"
    title="运行检查"
    description="本人持久节点、真实时间线与调用／依赖关系。手动刷新查看最新记录。"
    ><el-button :loading="loading" @click="refresh">刷新</el-button></PageHeader
  ><Feedback :error="loadError" />
  <div v-if="data" class="panel">
    <StatusBadge :status="data.run.status" /><el-descriptions :column="1" border
      ><el-descriptions-item label="运行标识"
        ><span class="mono">{{ data.run.traceId }}</span></el-descriptions-item
      ><el-descriptions-item label="模型标识">{{ data.run.modelId }}</el-descriptions-item
      ><el-descriptions-item label="模型尝试">{{ data.run.attempts }} 次</el-descriptions-item
      ><el-descriptions-item label="记录时间">{{
        dateTime(data.run.createdAt)
      }}</el-descriptions-item
      ><el-descriptions-item label="测试结果">{{
        data.run.mock ? '是' : '否'
      }}</el-descriptions-item></el-descriptions
    >
    <p class="muted small">
      服务器首次放行
      {{ dateTime(data.run.firstDeliverableAt) }}；该时间不代表浏览器收到回答或模型首次 Token。
    </p>
    <p v-if="data.run.telemetryDropped" class="inline-error">部分遥测记录已丢失。</p>
    <div class="toolbar">
      <RouterLink
        v-if="data.run.previousTraceId"
        :to="'/runs/' + encodeURIComponent(data.run.previousTraceId)"
        >上一执行 →</RouterLink
      ><RouterLink v-if="data.run.taskId" :to="'/tasks/' + data.run.taskId"
        >关联任务 #{{ data.run.taskId }}</RouterLink
      ><span v-if="data.run.sessionId" class="muted small">关联会话 #{{ data.run.sessionId }}</span>
    </div>
  </div>
  <RunGraph v-if="data" :key="data.run.traceId" :graph="data" />
</template>
