import { onScopeDispose, ref, shallowRef } from 'vue'
import { errorMessage, isAbort } from '@/shared/api/errors'
export function useLoad<T>() {
  const data = shallowRef<T | null>(null),
    loading = ref(false),
    loadError = ref('')
  let generation = 0,
    controller: AbortController | undefined
  async function load(query: (signal: AbortSignal) => Promise<T>) {
    const current = ++generation
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    data.value = null
    loading.value = true
    loadError.value = ''
    try {
      const value = await query(signal)
      if (generation === current && !signal.aborted) data.value = value
    } catch (e) {
      if (generation === current && !isAbort(e)) loadError.value = errorMessage(e)
    } finally {
      if (generation === current) loading.value = false
    }
  }
  onScopeDispose(() => {
    generation++
    controller?.abort()
  })
  return { data, loading, loadError, load }
}
