<script setup lang="ts">
import type { z } from 'zod'
import type { diagnosticSchema } from '@/shared/api/contracts/modelCalls'
defineProps<{ diagnostic?: z.infer<typeof diagnosticSchema> | null }>()
const locations: Record<string, string> = {
  TOKEN_RANGE: '字段原文',
  PARENT_RANGE: '缺失字段所在父对象',
  SYNTAX_WINDOW: '语法错误附近文本',
  ROOT_FALLBACK: '无法精确定位，使用根范围',
}
</script>
<template>
  <section v-if="diagnostic" class="diagnostic">
    <h4>本地校验诊断</h4>
    <p>契约 {{ diagnostic.schemaId }} · 来源 {{ diagnostic.origin }}</p>
    <p v-if="diagnostic.collectionTruncated">诊断数量已达到收集上限。</p>
    <p v-if="diagnostic.stoppedEarly">前置校验中止，后续字段未检查。</p>
    <p>位置为模型输出文本的 UTF-16 区间，开始包含、结束不包含；脱敏后内容长度可能变化。</p>
    <article v-for="(item, index) in diagnostic.items" :key="index">
      <p>{{ item.issue.path }} · {{ item.issue.rule }} · {{ item.issue.expected }}</p>
      <p>
        JSON Pointer {{ item.pointer }} · 类型 {{ item.actualType }} ·
        {{ locations[item.locationBasis || ''] || item.locationBasis }}（{{ item.locationBasis }}）
      </p>
      <p>
        位置 [{{ item.start ?? '未知' }}, {{ item.end ?? '未知' }}) · 行 {{ item.line ?? '未知' }} /
        列 {{ item.column ?? '未知' }}
      </p>
      <p v-if="item.excerptTruncated">长字段摘录已截断，保留首尾。</p>
      <pre tabindex="0">{{ item.excerptRaw ?? '未记录摘录' }}</pre>
    </article>
  </section>
</template>
<style scoped>
.diagnostic {
  overflow-wrap: anywhere;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
}
</style>
