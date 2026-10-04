<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue'
import type { EvidenceBundle, DocumentContent } from '@/shared/api/contracts/backend'
import { knowledgeApi } from '../api'
import { validRange } from '@/shared/lib/validation'
import { errorMessage, isAbort } from '@/shared/api/errors'
import Feedback from '@/shared/ui/Feedback.vue'
const props = defineProps<{ evidence: EvidenceBundle | null }>()
const emit = defineEmits<{ close: [] }>()
const content = ref<DocumentContent | null>(null),
  error = ref(''),
  busy = ref(false),
  excerpt = ref(''),
  oldVersion = ref(false)
let generation = 0,
  controller: AbortController | undefined
watch(
  () => props.evidence,
  async (e) => {
    const current = ++generation
    controller?.abort()
    content.value = null
    excerpt.value = ''
    error.value = ''
    oldVersion.value = false
    if (!e) return
    busy.value = true
    controller = new AbortController()
    try {
      const loaded = await knowledgeApi.document(e.document.id, controller.signal)
      if (current !== generation) return
      content.value = loaded
      oldVersion.value = loaded.document.documentVersion !== e.document.documentVersion
      if (oldVersion.value) excerpt.value = e.text
      else if (validRange(loaded.text, e.startOffset, e.endOffset))
        excerpt.value = loaded.text.slice(e.startOffset, e.endOffset)
      else {
        content.value = null
        throw new Error('证据范围超出当前原文，无法定位')
      }
    } catch (e) {
      if (current === generation && !isAbort(e)) {
        content.value = null
        excerpt.value = ''
        error.value = errorMessage(e)
      }
    } finally {
      if (current === generation) busy.value = false
    }
  },
  { immediate: true },
)
onScopeDispose(() => controller?.abort())
</script>
<template>
  <el-drawer
    :model-value="!!evidence"
    title="引用与原文"
    size="min(680px, 100vw)"
    @close="emit('close')"
    ><Feedback :error="error" />
    <p v-if="busy" class="muted">正在重新核验来源访问权限…</p>
    <template v-if="content && evidence"
      ><span class="eyebrow"
        >{{ evidence.evidenceId }} · 证据版本 {{ evidence.document.documentVersion }}</span
      >
      <h2>{{ evidence.document.title }}</h2>
      <p class="muted">
        {{ evidence.headingPath }} · 知识库 #{{ evidence.document.knowledgeBaseId }} · 处理代次
        {{ evidence.processingRevision }}
      </p>
      <el-alert
        v-if="oldVersion"
        title="当前原文已更新，以下为证据自身的旧版本文本；未在新版原文上定位。"
        type="warning"
        :closable="false"
      />
      <p class="mono muted">UTF-16 范围 [{{ evidence.startOffset }}, {{ evidence.endOffset }})</p>
      <pre class="source-text">{{ excerpt }}</pre>
      <el-descriptions :column="1" border
        ><el-descriptions-item label="召回小片">{{
          evidence.matchedChunkIds.join(', ') || '无'
        }}</el-descriptions-item
        ><el-descriptions-item label="交付上下文小片">{{
          evidence.includedChunkIds.join(', ') || '无'
        }}</el-descriptions-item></el-descriptions
      >
      <p class="muted small">
        引用集合不代表每一项都被答案使用。当前结构不用于验证旧处理代次的标识。
      </p>
      <RouterLink :to="`/documents/${content.document.id}`" @click="emit('close')"
        >查看当前文档 →</RouterLink
      ></template
    ></el-drawer
  >
</template>
