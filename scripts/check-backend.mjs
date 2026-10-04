import { mkdir, writeFile } from 'node:fs/promises'

const backend = process.env.API_PROXY_TARGET || 'http://localhost:8080'
const frontend = process.env.NOVID_TEST_ORIGIN || 'http://127.0.0.1:5173'
const results = []

async function check(origin, path, expectedStatus, expectedCode, options = {}) {
  try {
    const response = await fetch(new URL(path, origin), {
      ...options,
      signal: AbortSignal.timeout(10_000),
    })
    const body = await response.json().catch(() => null)
    const observed = { status: response.status, code: body?.code, health: body?.status }
    results.push({
      surface: origin === backend ? 'backend' : 'frontend-proxy',
      path,
      expectedStatus,
      ...observed,
      passed: response.status === expectedStatus && (!expectedCode || body?.code === expectedCode),
    })
  } catch {
    results.push({
      surface: origin === backend ? 'backend' : 'frontend-proxy',
      path,
      expectedStatus,
      passed: false,
      error: '连接失败或超时',
    })
  }
}

await check(backend, '/actuator/health', 200)
await check(frontend, '/actuator/health', 200)
await check(frontend, '/api/v1/auth/me', 401, 'AUTH_REQUIRED')
await check(frontend, '/api/v1/knowledge-bases', 401, 'AUTH_REQUIRED')
await check(frontend, '/api/v1/chat/stream', 401, 'AUTH_REQUIRED', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: '未登录联调探针',
    scope: { mode: 'SELF', knowledgeBaseIds: [], ownerUserId: null },
  }),
})
await check(frontend, '/api/v1/auth/login', 401, 'AUTH_REQUIRED', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: `probe_${crypto.randomUUID()}`,
    password: 'invalid-probe-only',
  }),
})

const report = { checkedAt: new Date().toISOString(), results }
await mkdir('var/live', { recursive: true })
await writeFile('var/live/preflight.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (results.some((result) => !result.passed)) process.exitCode = 1
