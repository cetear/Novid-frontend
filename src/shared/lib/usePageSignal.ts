import { onScopeDispose } from 'vue'
export function usePageSignal() {
  let controller = new AbortController()
  onScopeDispose(() => controller.abort())
  return {
    get signal() {
      return controller.signal
    },
    renew() {
      controller.abort()
      controller = new AbortController()
      return controller.signal
    },
  }
}
