<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ status: string }>()
const labels: Record<string, string> = {
  RECEIVED: '待处理',
  PROCESSING: '处理中',
  REUSED: '复用成功结果',
  PENDING: '等待',
  READY: '已就绪',
  FAILED: '失败',
  QUEUED: '等待执行',
  RUNNING: '正在生成',
  PAUSED: '已暂停',
  SUCCEEDED: '已完成',
  PARTIAL: '部分覆盖',
  CANCELLED: '已取消',
  SUCCESS: '已交付',
  NEEDS_INPUT: '需要补充信息',
  WAITING: '待确认',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
}
const type = computed(() =>
  ['READY', 'SUCCEEDED', 'SUCCESS', 'APPROVED'].includes(props.status)
    ? 'success'
    : ['FAILED', 'REJECTED'].includes(props.status)
      ? 'danger'
      : ['PAUSED', 'PARTIAL', 'NEEDS_INPUT'].includes(props.status)
        ? 'warning'
        : 'info',
)
</script>
<template>
  <el-tag :type="type" effect="light" round>{{ labels[status] || `未知状态：${status}` }}</el-tag>
</template>
