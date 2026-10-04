import { onScopeDispose, ref } from 'vue'
import { ApiError, isAbort } from '../api/errors'
export function usePoll(
  query: (signal: AbortSignal) => Promise<boolean>,
  onError: (e: unknown) => void,
  interval?: () => number,
) {
  const observing = ref(false),
    expired = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined,
    controller: AbortController | undefined,
    started = 0,
    failures = 0,
    cycle = 0
  let disposed = false
  function stop() {
    observing.value = false
    cycle++
    clearTimeout(timer)
    controller?.abort()
  }
  async function tick(generation: number) {
    if (!observing.value || generation !== cycle || document.hidden) return
    if (Date.now() - started > 30 * 60_000) {
      stop()
      expired.value = true
      return
    }
    controller = new AbortController()
    let again = true
    try {
      again = await query(controller.signal)
      failures = 0
    } catch (e) {
      if (isAbort(e)) return
      onError(e)
      failures++
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) again = false
    }
    if (generation !== cycle) return
    if (!again) {
      stop()
      return
    }
    timer = setTimeout(
      () => {
        void tick(generation)
      },
      failures
        ? Math.min(30_000, 2500 * 2 ** failures)
        : interval
          ? Math.min(60_000, Math.max(1000, interval()))
          : Date.now() - started > 30_000
            ? 5000
            : 2500,
    )
  }
  function start() {
    if (disposed) return
    stop()
    observing.value = true
    expired.value = false
    started = Date.now()
    failures = 0
    void tick(cycle)
  }
  function visibility() {
    clearTimeout(timer)
    controller?.abort()
    if (!document.hidden && observing.value) void tick(cycle)
  }
  document.addEventListener('visibilitychange', visibility)
  onScopeDispose(() => {
    disposed = true
    stop()
    document.removeEventListener('visibilitychange', visibility)
  })
  return { observing, expired, start, stop }
}
