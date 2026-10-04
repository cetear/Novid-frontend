import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
export const useKnownTasks = defineStore('known-tasks', () => {
  const ids = ref<number[]>([])
  const created = ref<TaskSnapshot | null>(null)
  function add(id: number) {
    ids.value = [id, ...ids.value.filter((n) => n !== id)].slice(0, 100)
  }
  function reset() {
    ids.value = []
    created.value = null
  }
  return { ids, created, add, reset }
})
