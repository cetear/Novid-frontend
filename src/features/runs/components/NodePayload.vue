<script setup lang="ts">
import type { TraceSpan } from '@/shared/api/contracts/backend'
defineProps<{ label: string; payload?: TraceSpan['input'] }>()
</script>

<template>
  <section class="node-payload" :aria-label="label">
    <h4>{{ label }}</h4>
    <template v-if="payload">
      <p v-if="payload.truncated" class="muted small">
        内容快照已截断：展示 {{ payload.content.length }} / {{ payload.originalChars }} 个字符。
      </p>
      <pre tabindex="0">{{ payload.content === '' ? '（空内容）' : payload.content }}</pre>
    </template>
    <p v-else class="muted small">未记录内容。历史运行或未采集快照的节点无法补回输入和输出。</p>
  </section>
</template>

<style scoped>
.node-payload {
  margin-top: 20px;
}
.node-payload h4 {
  margin-bottom: 8px;
}
.node-payload pre {
  max-height: 320px;
  overflow: auto;
  padding: 14px;
  border: 1px solid #d4e0d9;
  border-radius: 8px;
  background: #f3f6f3;
  color: #253b34;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
