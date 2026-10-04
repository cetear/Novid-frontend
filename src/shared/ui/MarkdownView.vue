<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { safeMarkdown } from '@/shared/security/markdown'
const props = defineProps<{ text: string }>()
const page = ref(0),
  pageSize = 40000
const html = computed(() =>
  safeMarkdown(props.text.slice(page.value * pageSize, (page.value + 1) * pageSize)),
)
watch(
  () => props.text,
  () => {
    if (page.value * pageSize > props.text.length) page.value = 0
  },
)
</script>
<template>
  <div>
    <p v-if="text.length > pageSize" class="muted small">
      长文本按片段展示，请翻阅完整内容；片段边界可能截断 Markdown 格式。
    </p>
    <!-- Only the sanitized renderer may produce HTML. -->
    <div class="markdown" v-html="html" />
    <div v-if="text.length > pageSize" class="page-stepper">
      <span class="muted">文本片段 {{ page + 1 }}/{{ Math.ceil(text.length / pageSize) }}</span>
      <div>
        <el-button :disabled="page === 0" @click="page--">上一片段</el-button
        ><el-button :disabled="(page + 1) * pageSize >= text.length" @click="page++"
          >下一片段</el-button
        >
      </div>
    </div>
  </div>
</template>
