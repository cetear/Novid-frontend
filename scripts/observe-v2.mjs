import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import assert from 'node:assert/strict'

// Read existing synthetic tasks; never create or approve another generation.
if (existsSync('.env.live.local')) process.loadEnvFile('.env.live.local')
const taskId = Number(process.env.NOVID_V2_OBSERVE_TASK_ID)
const documentId = Number(process.env.NOVID_V2_OBSERVE_DOCUMENT_ID)
assert(Number.isSafeInteger(taskId) && taskId > 0)
assert(Number.isSafeInteger(documentId) && documentId > 0)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5173' })
const report = { taskId, documentId, startedAt: new Date().toISOString(), checks: [], cleanup: [] }
let token = ''
async function save() {
  await mkdir('var/live', { recursive: true })
  await writeFile('var/live/v2-observation-2026-10-09.json', JSON.stringify(report, null, 2) + '\n')
}
async function api(path, method = 'GET', data) {
  const response = await page.request.fetch('/api/v1' + path, {
    method,
    data,
    timeout: 30_000,
    headers: { Authorization: 'Bearer ' + token },
  })
  if (response.status() !== 200 && response.status() !== 204) {
    const error = await response.json().catch(() => ({}))
    throw new Error(`${path}: HTTP ${response.status()} ${error.code ?? 'HTTP_ERROR'}`)
  }
  return response
}
try {
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME)
  await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD)
  const pending = page
    .waitForResponse((r) => r.url().endsWith('/auth/login'))
    .then(async (response) => {
      assert.equal(response.status(), 200)
      return response.json()
    })
  await page.getByRole('button', { name: '登录工作台' }).click()
  token = (await pending).token
  const deadline = Date.now() + 600_000
  let task
  while (Date.now() < deadline) {
    task = await (await api('/tasks/' + taskId)).json()
    assert.equal(task.taskType, 'NOTES_PPT')
    report.task = task
    const planResponse = await api('/tasks/' + taskId + '/content-plan')
    if (planResponse.status() === 200) report.plan = await planResponse.json()
    await save()
    if (!['QUEUED', 'RUNNING'].includes(task.status)) break
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  assert(['WAITING_APPROVAL', 'FAILED'].includes(task.status), task.status)
  if (task.status === 'FAILED') {
    report.checks.push({ name: 'PPT 真实预览生成', status: 'FAIL', detail: task.errorCode })
    process.exitCode = 1
  } else {
    const preview = await (await api('/tasks/' + taskId + '/preview')).json()
    assert(
      preview.sourceDependencies.some((s) => s.documentId === documentId),
      'Only observe the expected synthetic source',
    )
    report.expectedSourceVerified = true
    assert.equal(preview.contentPlan.planHash, report.plan.planHash)
    assert.equal(preview.units.length, report.plan.plan.counts.contentSlides)
    assert.equal(preview.contentPlan.totalSlides, report.plan.plan.counts.totalSlides)
    report.preview = preview
  }
  assert.deepEqual(await (await api('/tasks/' + taskId + '/media-plans')).json(), [])
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByLabel('已知任务 ID').fill(String(taskId))
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await page
    .locator('.content-plan')
    .getByText('总计 ' + report.plan.plan.counts.totalSlides + ' 页', { exact: false })
    .waitFor()
  if (task.status === 'FAILED')
    await page.locator('.panel > p.inline-error').filter({ hasText: task.errorCode }).waitFor()
  report.checks.push({ name: 'PPT 原任务内容计划与真实浏览器状态', status: 'PASS' })
  const runs = await (await api('/runs?page=0&size=100')).json()
  report.graphs = []
  for (const run of runs.filter((r) => r.taskId === taskId)) {
    const graph = await (await api('/runs/' + encodeURIComponent(run.traceId) + '/graph')).json()
    assert(graph.nodes.length > 0)
    assert(graph.nodes.some((n) => n.type === 'MODEL'))
    report.graphs.push({
      traceId: run.traceId,
      nodes: graph.nodes.length,
      incomplete: graph.incomplete,
    })
  }
  assert(report.graphs.length > 0)
  report.checks.push({ name: 'PPT 原任务持久运行图', status: 'PASS' })
} catch (e) {
  report.checks.push({ name: 'PPT 原任务复核', status: 'FAIL', detail: e.message.slice(0, 1000) })
  process.exitCode = 1
} finally {
  if (token && report.task?.taskType === 'NOTES_PPT' && report.expectedSourceVerified) {
    try {
      const latest = await (await api('/tasks/' + taskId)).json()
      if (['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(latest.status))
        await api('/tasks/' + taskId + '/actions', 'POST', { action: 'cancel' })
      report.cleanup.push({ taskId, status: '终态或已取消' })
    } catch {
      report.cleanup.push({ taskId, status: '清理未确认' })
      process.exitCode = 1
    }
  }
  if (report.task?.status === 'FAILED')
    report.cleanup.push({ taskId, status: '已失败，终态无取消或删除接口' })
  if (token)
    try {
      await api('/auth/logout', 'POST')
      report.cleanup.push({ resource: 'token', status: 'REVOKED' })
    } catch {
      process.exitCode = 1
    }
  report.finishedAt = new Date().toISOString()
  await save()
  await browser.close()
}
console.info(JSON.stringify({ checks: report.checks, cleanup: report.cleanup }))
