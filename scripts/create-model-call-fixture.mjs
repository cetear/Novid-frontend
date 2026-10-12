import { mkdir, writeFile } from 'node:fs/promises'
process.loadEnvFile('.env.live.local')
const origin = process.env.API_PROXY_TARGET || 'http://localhost:8080'
let token = ''
const evidence = {
  date: '2026-10-13',
  synthetic: true,
  createdAt: new Date().toISOString(),
  baseId: 0,
  documentId: 0,
  taskId: 0,
  selected: null,
}
async function save() {
  await mkdir('var/live', { recursive: true })
  await writeFile('var/live/model-calls-fixture-2026-10-13.json', JSON.stringify(evidence, null, 2))
}
async function api(path, method = 'GET', data, form) {
  const r = await fetch(origin + '/api/v1' + path, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: form || (data ? JSON.stringify(data) : undefined),
  })
  const body = await r.json().catch(() => null)
  if (![200, 202, 204].includes(r.status))
    throw new Error(path + ': HTTP ' + r.status + ' / ' + body?.code)
  return body
}
try {
  token = (
    await api('/auth/login', 'POST', {
      username: process.env.NOVID_TEST_USERNAME,
      password: process.env.NOVID_TEST_PASSWORD,
    })
  ).token
  const marker = 'call-archive-' + crypto.randomUUID().slice(0, 8)
  evidence.baseId = (
    await api('/knowledge-bases', 'POST', {
      name: marker,
      description: '10-13 模型调用归档合成资料，验证后清理',
    })
  ).id
  const form = new FormData()
  form.set('knowledgeBaseId', String(evidence.baseId))
  form.set(
    'file',
    new Blob(
      [
        '# 备份规则\n\n每周三21:30执行备份。备份文件保留七天。恢复后核对校验和，一致才确认恢复成功。',
      ],
      { type: 'text/markdown' },
    ),
    marker + '.md',
  )
  evidence.documentId = (await api('/documents', 'POST', undefined, form)).id
  await save()
  for (let i = 0; i < 100; i++) {
    const doc = (await api('/documents/' + evidence.documentId)).document
    if (doc.ingestionStatus === 'READY') break
    if (doc.ingestionStatus === 'FAILED') throw new Error('测试资料入库失败')
    await new Promise((r) => setTimeout(r, 3000))
  }
  const task = await api('/tasks', 'POST', {
    taskType: 'QUIZ_GENERATION',
    documentIds: [evidence.documentId],
    strategy: 'FIXED',
    scope: { mode: 'SELECTED', knowledgeBaseIds: [evidence.baseId], ownerUserId: null },
    quizOptions: { questionCount: 1, questionTypes: ['SHORT_ANSWER'], difficulty: 'EASY' },
    remarks: '仅出一道简答题，答案只陈述资料中的备份规则。',
  })
  evidence.taskId = task.taskId
  await save()
  console.log(
    JSON.stringify({
      taskId: evidence.taskId,
      baseId: evidence.baseId,
      documentId: evidence.documentId,
    }),
  )
  const deadline = Date.now() + 1800000
  while (Date.now() < deadline) {
    evidence.task = await api('/tasks/' + evidence.taskId)
    const runs = await api('/runs?page=0&size=20')
    for (const run of runs.filter((r) => r.taskId === evidence.taskId)) {
      const calls = await api('/runs/' + run.traceId + '/calls?page=0&size=20')
      if (calls.some((c) => c.input.state === 'READY' && c.output.state === 'READY')) {
        evidence.selected = {
          run,
          calls,
          graph: await api('/runs/' + run.traceId + '/graph?view=summary'),
        }
        break
      }
    }
    await save()
    if (evidence.selected) {
      console.log(
        JSON.stringify({
          traceId: evidence.selected.run.traceId,
          calls: evidence.selected.calls.length,
          taskStatus: evidence.task.status,
        }),
      )
      break
    }
    if (!['RUNNING', 'QUEUED'].includes(evidence.task.status))
      throw new Error('任务已终结但未产生可用归档：' + evidence.task.errorCode)
    await new Promise((r) => setTimeout(r, 5000))
  }
  if (!evidence.selected) throw new Error('30分钟内未观察到完整归档')
} catch (e) {
  evidence.error = e.message
  await save()
  throw e
} finally {
  if (token) await api('/auth/logout', 'POST')
}
