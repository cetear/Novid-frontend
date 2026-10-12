import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
if (existsSync('.env.live.local')) process.loadEnvFile('.env.live.local')
const origin = process.env.API_PROXY_TARGET || 'http://localhost:8080'
const checks = []
let token = ''
async function call(path, method = 'GET', data, key) {
  const response = await fetch(origin + '/api/v1' + path, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: await response.json().catch(() => null),
  }
}
try {
  if (!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD)
    throw new Error('缺少受控联调账号')
  const login = await call('/auth/login', 'POST', {
    username: process.env.NOVID_TEST_USERNAME,
    password: process.env.NOVID_TEST_PASSWORD,
  })
  if (login.status !== 200) throw new Error('登录失败 HTTP ' + login.status)
  token = login.body.token
  for (const id of [202, 203, 204]) {
    const task = await call('/tasks/' + id)
    const plan = await call('/tasks/' + id + '/retry-plan')
    checks.push({ name: '历史任务续跑资格', taskId: id, task: task.body, plan })
    if (plan.status !== 200) continue
    // Only send requests proven ineligible or stale; never spend budget on deleted sources.
    if (!plan.body.canContinue)
      checks.push({
        name: '资格拒绝',
        taskId: id,
        expected: 400,
        result: await call(
          '/tasks/' + id + '/retry',
          'POST',
          { mode: 'CONTINUE', expectedStateVersion: plan.body.stateVersion },
          crypto.randomUUID(),
        ),
      })
    checks.push({
      name: '状态冲突',
      taskId: id,
      expected: 409,
      result: await call(
        '/tasks/' + id + '/retry',
        'POST',
        { mode: 'CONTINUE', expectedStateVersion: plan.body.stateVersion + 100000 },
        crypto.randomUUID(),
      ),
    })
  }
  checks.push({
    name: '未开放模式',
    expected: 400,
    result: await call(
      '/tasks/203/retry',
      'POST',
      { mode: 'REVIEW', expectedStateVersion: 1 },
      crypto.randomUUID(),
    ),
  })
} finally {
  if (token)
    checks.push({ name: '注销', expected: 200, result: await call('/auth/logout', 'POST') })
  await mkdir('var/live', { recursive: true })
  await writeFile(
    'var/live/retry-2026-10-12.json',
    JSON.stringify({ checkedAt: new Date().toISOString(), origin, checks }, null, 2),
  )
  for (const check of checks)
    console.log(
      JSON.stringify({
        name: check.name,
        taskId: check.taskId,
        status: check.result?.status ?? check.plan?.status,
        code: check.result?.body?.code,
        canContinue: check.plan?.body?.canContinue,
        blockers: check.plan?.body?.blockers,
      }),
    )
}
if (
  checks.some((c) => c.expected && c.result.status !== c.expected) ||
  checks.filter((c) => c.plan).some((c) => c.plan.status !== 200)
)
  process.exitCode = 1
