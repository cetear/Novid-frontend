<script setup lang="ts">
import type { PayloadRef } from '@/shared/api/contracts/modelCalls'
defineProps<{ label: string; payload: PayloadRef }>()
const states: Record<string, string> = {
  READY: '完整归档',
  WRITING: '归档写入中',
  SAVE_FAILED: '归档保存失败',
  SIZE_LIMIT: '超过归档容量',
  INCOMPLETE: '归档不完整',
  NOT_CAPTURED: '未采集',
  DISABLED: '采集关闭',
  SIMULATED: '模拟内容',
  EXPIRED: '归档已过期',
  ACCESS_REVOKED: '访问已撤销',
}
</script>
<template>
  <section>
    <h4>{{ label }}归档</h4>
    <p>
      {{ states[payload.state] || payload.state }} · {{ payload.rawBytes }} UTF-8 字节 ·
      {{ payload.charCount }} UTF-16 单位 · {{ payload.chunkCount }} 块
    </p>
    <p>
      存储 {{ payload.storedBytes }} 字节 ·
      {{ payload.redacted ? '已脱敏' : '未标记脱敏' }}；字符数不等于模型词元数。
    </p>
    <p class="mono small">
      校验和 {{ payload.checksum ?? '未记录' }} · 到期 {{ payload.expiresAt ?? '未记录' }}
    </p>
    <pre v-if="payload.preview !== null && payload.state !== 'ACCESS_REVOKED'" tabindex="0">{{
      payload.preview
    }}</pre>
  </section>
</template>
<style scoped>
section {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
