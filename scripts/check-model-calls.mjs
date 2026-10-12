import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
if (existsSync('.env.live.local')) process.loadEnvFile('.env.live.local')
const origin = process.env.API_PROXY_TARGET || 'http://localhost:8080'
let token = ''
const evidence = { date: '2026-10-13', runs: [], selected: null, checks: [] }
async function api(path, method = 'GET', data) {
  const r = await fetch(origin + '/api/v1' + path, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  const body = await r.json().catch(() => null)
  if (r.status !== 200) throw new Error(path + ': HTTP ' + r.status + ' / ' + body?.code)
  return body
}
try {
  token = (
    await api('/auth/login', 'POST', {
      username: process.env.NOVID_TEST_USERNAME,
      password: process.env.NOVID_TEST_PASSWORD,
    })
  ).token
  for (let page = 0; page < 4 && !evidence.selected; page++) {
    const runs = await api('/runs?page=' + page + '&size=20')
    for (const run of runs) {
      const calls = await api('/runs/' + run.traceId + '/calls?page=0&size=20')
      evidence.runs.push({ traceId: run.traceId, taskId: run.taskId, callCount: calls.length })
      if (calls.length) {
        evidence.selected = {
          run,
          calls,
          graph: await api('/runs/' + run.traceId + '/graph?view=summary'),
        }
        break
      }
    }
    if (runs.length < 20) break
  }
  console.log(
    JSON.stringify({
      scanned: evidence.runs.length,
      selected: evidence.selected?.run.traceId,
      calls: evidence.selected?.calls.length,
    }),
  )
} finally {
  if (token) await api('/auth/logout', 'POST')
  await mkdir('var/live', { recursive: true })
  await writeFile('var/live/model-calls-2026-10-13.json', JSON.stringify(evidence, null, 2))
}
