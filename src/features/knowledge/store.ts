import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ScopeRequest } from '@/shared/api/contracts/backend'
export const selfScope = (): ScopeRequest => ({
  mode: 'SELF',
  knowledgeBaseIds: [],
  ownerUserId: null,
})
export const useKnowledgeScope = defineStore('knowledge-scope', () => {
  const scope = ref<ScopeRequest>(selfScope()),
    revision = ref(0),
    disabledIds = ref<number[]>([])
  function set(value: ScopeRequest) {
    scope.value = structuredClone(value)
    revision.value++
  }
  function reset() {
    set(selfScope())
    disabledIds.value = []
  }
  function rememberDisabled(id: number) {
    disabledIds.value = [id, ...disabledIds.value.filter((n) => n !== id)].slice(0, 100)
  }
  return { scope, revision, disabledIds, set, reset, rememberDisabled }
})
