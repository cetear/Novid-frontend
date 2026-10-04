<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { KnowledgeBaseSnapshot } from '@/shared/api/contracts/backend'
import { knowledgeApi } from '../api'
import { selfScope } from '../store'
import { useAction } from '@/shared/lib/useAction'
import PageStepper from '@/shared/ui/PageStepper.vue'
import Feedback from '@/shared/ui/Feedback.vue'
defineProps<{ modelValue: number | null }>()
defineEmits<{ 'update:modelValue': [value: number] }>()
const bases = ref<KnowledgeBaseSnapshot[]>([]),
  page = ref(0),
  { busy, error, run } = useAction()
function load(n = 0) {
  void run(async () => {
    bases.value = []
    page.value = n
    bases.value = await knowledgeApi.bases(selfScope(), n)
  })
}
onMounted(() => load())
</script>
<template>
  <div class="own-base-select">
    <el-select
      :model-value="modelValue"
      :loading="busy"
      placeholder="选择本人启用的知识库"
      aria-label="目标知识库"
      @update:model-value="$emit('update:modelValue', $event)"
      ><el-option
        v-for="base in bases"
        :key="base.id"
        :label="`${base.name} · #${base.id}`"
        :value="base.id" /></el-select
    ><PageStepper :page="page" :busy="busy" :count="bases.length" @change="load" /><Feedback
      :error="error"
    />
  </div>
</template>
