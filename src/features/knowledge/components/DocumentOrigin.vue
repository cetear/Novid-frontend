<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue'
import { knowledgeApi } from '../api'
import { ApiError } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import type { z } from 'zod'
import type { originSchema, participationSchema } from '@/shared/api/contracts/workflow'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const props = defineProps<{ documentId: number; version: number; revision: number | null }>()
const emit = defineEmits<{ invalidated: [error: unknown] }>()
let generation = 0
onScopeDispose(() => generation++)
const { busy, error, run } = useAction()
const origin = ref<z.infer<typeof originSchema> | null>(null),
  related = ref<z.infer<typeof participationSchema>[]>([]),
  page = ref(0),
  mappingPage = ref(0)
watch(
  () => [props.documentId, props.version, props.revision],
  () => {
    generation++
    origin.value = null
    related.value = []
  },
)
function load(next = page.value) {
  void run(async () => {
    const current = ++generation
    origin.value = null
    related.value = []
    try {
      const [o, r] = await Promise.all([
        knowledgeApi.origin(props.documentId),
        knowledgeApi.compilations(props.documentId, next),
      ])
      if (current !== generation) return
      origin.value = o
      related.value = r
      page.value = next
    } catch (e) {
      if (current !== generation) return
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) emit('invalidated', e)
      throw e
    }
  })
}
</script>
<template>
  <section class="panel">
    <h3>资料来源与整编关系</h3>
    <el-button :loading="busy" @click="load()">核验来源关系</el-button
    ><Feedback :error="error" /><template v-if="origin"
      ><p>
        {{ origin.originType }} · 生成版本 {{ origin.generatedVersion }} · 映射
        {{ origin.mappingValid ? '有效' : '失效或不适用' }} · 解析绑定 {{ origin.bindingStatus }}
      </p>
      <RouterLink v-if="origin.taskId" :to="'/tasks/' + origin.taskId"
        >查看生成任务 #{{ origin.taskId }}</RouterLink
      >
      <p v-for="s in origin.directSources" :key="s.documentId">
        {{ s.title }} · 文档 #{{ s.documentId }} · 历史 v{{ s.documentVersion }}
      </p>
      <p class="muted small">
        历史来源位置不能用于定位当前正文。编辑后的失效映射不用于自测章节划分。
      </p>
      <details v-if="origin.mappingValid">
        <summary>逻辑章节与当前解析区间</summary>
        <p
          v-for="b in origin.parsedBindings.slice(mappingPage * 20, (mappingPage + 1) * 20)"
          :key="b.logicalSectionId + ':' + b.parsedSectionId"
        >
          {{ b.chapterId }} / {{ b.logicalSectionId }} → {{ b.parsedSectionId }} · 代次
          {{ b.processingRevision }} · [{{ b.startOffset }}, {{ b.endOffset }}) UTF-16
        </p>
        <PageStepper :page="mappingPage" @change="mappingPage = $event" /></details
    ></template>
    <h4>使用本资料的整编文档</h4>
    <p v-for="r in related" :key="r.documentId">
      <RouterLink :to="'/documents/' + r.documentId"
        >{{ r.title }} · 当前 v{{ r.currentVersion }}</RouterLink
      >
      · 使用来源版本 {{ r.sourceVersions.join('、') }}
    </p>
    <PageStepper :page="page" :busy="busy" :count="related.length" @change="load" />
    <p class="muted small">关系按权限过滤，本页不足 20 项仍可继续翻页。</p>
  </section>
</template>

<style scoped>
section {
  overflow-wrap: anywhere;
}
</style>
