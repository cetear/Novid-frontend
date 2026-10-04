import { ref, onMounted } from 'vue'
import { sessionsApi } from './sessionsApi'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import { errorMessage } from '@/shared/api/errors'
import type { SessionSnapshot, SessionMessage } from '@/shared/api/contracts/backend'

export function useSessions() {
  const active = ref<SessionSnapshot | null>(null),
    history = ref<SessionMessage[]>([])
  const list = ref<SessionSnapshot[]>([]),
    page = ref(0),
    title = ref(''),
    busy = ref(false),
    error = ref('')
  const requests = usePageSignal()
  let createTitle = '',
    createKey = '',
    generation = 0
  function clear() {
    generation++
    requests.renew()
    active.value = null
    history.value = []
    busy.value = false
  }
  async function action(work: (signal: AbortSignal) => Promise<void>) {
    if (busy.value) return
    const current = generation,
      signal = requests.signal
    busy.value = true
    error.value = ''
    try {
      await work(signal)
    } catch (e) {
      if (current === generation && !signal.aborted) error.value = errorMessage(e)
    } finally {
      if (current === generation) busy.value = false
    }
  }
  async function refreshList(n = page.value) {
    await action(async (signal) => {
      const rows = await sessionsApi.list(n, signal)
      page.value = n
      list.value = rows
    })
  }
  async function select(id: number) {
    clear()
    await action(async (signal) => {
      const session = await sessionsApi.get(id, signal)
      const rows = await sessionsApi.messages(id, 0, signal)
      active.value = session
      history.value = rows
    })
  }
  async function sync() {
    if (!active.value) return
    const id = active.value.id
    // Re-read from zero so revoked sources replace any cached content.
    history.value = []
    active.value = null
    await action(async (signal) => {
      const session = await sessionsApi.get(id, signal)
      const rows = await sessionsApi.messages(id, 0, signal)
      active.value = session
      history.value = rows
    })
  }
  async function more() {
    if (!active.value) return
    const id = active.value.id,
      cursor = history.value.at(-1)?.seq ?? 0
    history.value = []
    await action(async (signal) => {
      // Re-read all previously displayed events to honor RESTRICTED updates.
      const rows: SessionMessage[] = []
      let after = 0
      while (true) {
        const batch = await sessionsApi.messages(id, after, signal)
        if (!batch.length) break
        const next = batch.at(-1)!.seq
        if (next <= after) throw new Error('历史游标没有推进')
        rows.push(...batch)
        after = next
        if (after > cursor || batch.length < 20) break
      }
      history.value = rows
    })
  }
  async function create() {
    await action(async (signal) => {
      if (!createKey || createTitle !== title.value) {
        createTitle = title.value
        createKey = crypto.randomUUID()
      }
      const session = await sessionsApi.create(createTitle, createKey, signal)
      active.value = session
      history.value = []
      list.value = [session, ...list.value.filter((s) => s.id !== session.id)].slice(0, 20)
      createKey = ''
    })
  }
  async function remove() {
    if (!active.value) return
    const shown = active.value
    await action(async (signal) => {
      const latest = await sessionsApi.get(shown.id, signal)
      active.value = latest
      if (latest.version !== shown.version)
        throw new Error('会话版本已变化，请刷新历史并核对后再删除')
      try {
        await sessionsApi.delete(latest.id, latest.version, signal)
      } catch (e) {
        history.value = []
        throw e
      }
      active.value = null
      history.value = []
      list.value = list.value.filter((s) => s.id !== latest.id)
    })
  }
  onMounted(() => {
    void refreshList()
  })
  return {
    active,
    history,
    list,
    page,
    title,
    busy,
    error,
    clear,
    refreshList,
    select,
    sync,
    more,
    create,
    remove,
  }
}
