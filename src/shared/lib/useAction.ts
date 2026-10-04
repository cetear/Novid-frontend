import { ref, onScopeDispose } from 'vue'
import { errorMessage, isAbort } from '../api/errors'
export function useAction() {
  const busy = ref(false),
    error = ref(''),
    notice = ref('')
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  async function run<T>(action: () => Promise<T>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      return await action()
    } catch (e) {
      if (!disposed && !isAbort(e)) error.value = errorMessage(e)
    } finally {
      if (!disposed) busy.value = false
    }
  }
  return { busy, error, notice, run }
}
