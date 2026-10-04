<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ScopeMode } from '@/shared/api/contracts/backend'
import { parseIds, positiveId } from '@/shared/lib/validation'
import { useKnowledgeScope } from '../store'
const props = defineProps<{ admin: boolean }>()
const store = useKnowledgeScope(),
  mode = ref<ScopeMode>('SELF'),
  ids = ref(''),
  owner = ref(''),
  error = ref('')
watch(
  () => store.revision,
  () => {
    mode.value = store.scope.mode
    ids.value = store.scope.knowledgeBaseIds.join(',')
    owner.value = store.scope.ownerUserId?.toString() || ''
  },
  { immediate: true },
)
function apply() {
  try {
    if (mode.value === 'ALL' && !props.admin) throw new Error('全部范围仅管理员可用')
    store.set({
      mode: mode.value,
      knowledgeBaseIds: mode.value === 'SELECTED' ? parseIds(ids.value, 100) : [],
      ownerUserId:
        props.admin && mode.value !== 'SELF' && owner.value.trim()
          ? positiveId(owner.value.trim())
          : null,
    })
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : '范围无效'
  }
}
</script>
<template>
  <section class="scope-picker" aria-label="读取范围">
    <span class="scope-label">读取范围</span
    ><el-select v-model="mode" aria-label="范围模式" class="scope-mode"
      ><el-option label="我的资料" value="SELF" /><el-option
        label="指定知识库"
        value="SELECTED" /><el-option v-if="admin" label="全部授权资料" value="ALL" /></el-select
    ><el-input
      v-if="mode === 'SELECTED'"
      v-model="ids"
      aria-label="知识库 ID"
      placeholder="知识库 ID，逗号分隔"
      class="scope-ids"
    /><el-input
      v-if="admin && mode !== 'SELF'"
      v-model="owner"
      aria-label="所有者 ID 筛选"
      placeholder="所有者 ID（可选）"
      class="scope-owner"
    /><el-button @click="apply">应用范围</el-button
    ><span
      v-if="store.scope.mode === 'SELECTED' && !store.scope.knowledgeBaseIds.length"
      class="muted"
      >当前为零范围</span
    ><span v-if="error" role="alert" class="inline-error">{{ error }}</span>
  </section>
</template>
