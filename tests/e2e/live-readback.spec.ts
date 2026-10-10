import { test, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { loginSchema, graphSchema, taskSchema } from '../../src/shared/api/contracts/backend'
import {
  feeSchema,
  feeAggregateSchema,
  metricsSchema,
  auditSchema,
  catalogSchema,
  capabilitySchema,
} from '../../src/shared/api/contracts/media'

test('真实后端：请求编号、费用账本、管理观测和媒体登记能力', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(120_000)
  let token = ''
  const checks: Array<{ name: string; status: string; detail?: unknown }> = []
  const requests: Array<{ path: string; status: number; requestId: string | undefined }> = []
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), checks, requests }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  async function api(path: string, method = 'GET', data?: unknown) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      headers: { Authorization: 'Bearer ' + token },
    })
    const requestId = response.headers()['x-request-id']
    requests.push({ path, status: response.status(), requestId })
    expect(requestId).toMatch(uuid)
    expect(response.headers()['cache-control']).toContain('no-store')
    return response
  }
  async function check(name: string, work: () => Promise<unknown>) {
    console.info('[真实观测] ' + name)
    try {
      checks.push({ name, status: 'PASS', detail: await test.step(name, work) })
    } catch (e) {
      checks.push({
        name,
        status: 'FAIL',
        detail: e instanceof Error ? e.message.slice(0, 500) : '检查失败',
      })
    }
  }
  try {
    await page.goto('/login')
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const pending = page.waitForResponse(
      (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '登录工作台' }).click()
    const login = await pending
    expect(login.status()).toBe(200)
    const identity = loginSchema.parse(await login.json())
    token = identity.token
    await expect(page).toHaveURL(/\/chat$/)
    expect(login.headers()['x-request-id']).toMatch(uuid)
    report.actor = { id: identity.user.id, role: identity.user.role }
    const previous: {
      documentId?: number
      ingestion?: { ingestionId: number }
      jsonAnswer?: { traceId: string }
      graphs?: Array<{ traceId: string }>
      checks?: Array<{ detail?: { taskId?: number } }>
      cleanup?: Array<{ resource: string; id?: number }>
    } = JSON.parse(await readFile('var/live/protocol-v2-2026-10-09.json', 'utf8'))
    const taskIds =
      previous.cleanup?.filter((c) => c.resource === 'task' && c.id).map((c) => c.id!) ?? []
    await check('学习任务终态及失败页面如实呈现', async () => {
      expect(taskIds).toHaveLength(2)
      const states = []
      for (const id of taskIds) {
        const response = await api('/tasks/' + id)
        expect(response.status()).toBe(200)
        const task = taskSchema.parse(await response.json())
        states.push({
          taskId: id,
          taskType: task.taskType,
          status: task.status,
          errorCode: task.errorCode,
          artifactId: task.artifactId,
        })
        if (task.status !== 'FAILED') continue
        const result = await api('/tasks/' + id + '/result')
        expect(result.status()).toBe(409)
        expect((await result.json()).code).toBe('WORKFLOW_RESULT_UNAVAILABLE')
        await page.getByRole('link', { name: '学习与制作', exact: true }).click()
        await page.getByLabel('已知任务 ID').fill(String(id))
        await page.getByRole('button', { name: '打开', exact: true }).click()
        await expect(page.locator('.task-facts')).toBeVisible()
        await expect(page.locator('.inline-error').first()).toContainText(task.errorCode!)
        await expect(page.getByRole('button', { name: '恢复', exact: true })).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: '核验并查看学习结果', exact: true }),
        ).toHaveCount(0)
        await expect(page.getByRole('button', { name: '下载 Markdown', exact: true })).toHaveCount(
          0,
        )
      }
      return states
    })
    await check('真实运行图读取与缺失提示', async () => {
      expect(previous.jsonAnswer?.traceId).toBeTruthy()
      const traceId = previous.jsonAnswer!.traceId
      const response = await api('/runs/' + encodeURIComponent(traceId) + '/graph')
      expect(response.status()).toBe(200)
      const graph = graphSchema.parse(await response.json())
      await page.getByRole('link', { name: '运行检查', exact: true }).click()
      await page.getByRole('link', { name: traceId, exact: true }).click()
      await expect(page.getByRole('heading', { name: '实际调用与依赖', exact: true })).toBeVisible()
      if (!graph.nodes.length) {
        await expect(page.getByText('暂无节点记录', { exact: false })).toBeVisible()
        await expect(page.locator('.run-graph g')).toHaveCount(0)
      }
      if (graph.incomplete)
        await expect(page.getByText('运行图不完整', { exact: false })).toBeVisible()
      return {
        traceId,
        nodes: graph.nodes.length,
        summaryNodeCount: graph.run.nodeCount,
        incomplete: graph.incomplete,
        telemetryDropped: graph.run.telemetryDropped,
      }
    })
    await check('本人任务、运行和入库代次的独立费用', async () => {
      const paths = [
        ...taskIds.map((id) => '/tasks/' + id + '/fees'),
        ...(previous.ingestion?.ingestionId
          ? ['/ingestions/' + previous.ingestion.ingestionId + '/fees']
          : []),
        ...(previous.jsonAnswer
          ? ['/runs/' + encodeURIComponent(previous.jsonAnswer.traceId) + '/fees']
          : []),
      ]
      expect(paths.length).toBeGreaterThanOrEqual(3)
      const fees = []
      for (const path of paths) {
        const response = await api(path)
        expect(response.status()).toBe(200)
        const fee = feeSchema.parse(await response.json())
        fees.push({
          kind: fee.kind,
          resourceId: fee.resourceId,
          costStatus: fee.costStatus,
          attempts: fee.attempts,
          estimatedAmount: fee.estimatedAmount,
          reservedAmount: fee.reservedAmount,
          currency: fee.currency,
        })
      }
      await page.getByRole('link', { name: '费用记录', exact: true }).click()
      await page.getByLabel('费用资源标识').fill(String(taskIds[0]))
      await page.getByRole('button', { name: '查询费用', exact: true }).click()
      await expect(page.locator('.fee-panel .el-alert--error')).toHaveCount(0)
      await expect(page.locator('.fee-panel .fee-stats')).toContainText('估算')
      return fees
    })
    await check('视频目录和真实登记能力可解析', async () => {
      const catalogResponse = await api('/media/catalogs')
      expect(catalogResponse.status()).toBe(200)
      const catalogs = z.array(catalogSchema).parse(await catalogResponse.json())
      const capabilityResponse = await api('/media/video-capabilities')
      expect(capabilityResponse.status()).toBe(200)
      const capabilities = z.array(capabilitySchema).parse(await capabilityResponse.json())
      return {
        catalogs: catalogs.length,
        enabledCatalogs: catalogs.filter((c) => c.enabled).length,
        capabilities: capabilities.length,
        verificationStatuses: capabilities.map((c) => c.verificationStatus),
      }
    })
    await check('旧学习工作流拒绝创建，410 及请求编号保留', async () => {
      const retired = []
      for (const taskType of ['FAQ', 'RESEARCH_REPORT']) {
        const response = await page.request.post('/api/v1/tasks', {
          headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': crypto.randomUUID() },
          data: { taskType, topic: '已退役工作流边界验证', documentIds: [previous.documentId] },
        })
        expect(response.status()).toBe(410)
        const detail = await response.json()
        expect(detail).toMatchObject({ code: 'WORKFLOW_RETIRED', retryable: false })
        expect(response.headers()['x-request-id']).toMatch(uuid)
        retired.push({
          taskType,
          status: response.status(),
          code: detail.code,
          requestId: response.headers()['x-request-id'],
        })
      }
      return retired
    })
    if (identity.user.role === 'ADMIN')
      await check('管理员指标、费用聚合和访问审计', async () => {
        const metricsResponse = await api('/admin/metrics?days=1')
        expect(metricsResponse.status()).toBe(200)
        const metrics = metricsSchema.parse(await metricsResponse.json())
        const feesResponse = await api('/admin/fees?days=1')
        expect(feesResponse.status()).toBe(200)
        const fees = z.array(feeAggregateSchema).parse(await feesResponse.json())
        const auditResponse = await api('/admin/access-audit?afterId=0&size=20')
        expect(auditResponse.status()).toBe(200)
        const audits = z.array(auditSchema).parse(await auditResponse.json())
        await page.getByRole('link', { name: '运营与审计', exact: true }).click()
        await expect(page.locator('.metrics-grid')).toBeVisible()
        if (audits.some((row) => row.scopeMode === null || row.outcome === null))
          await expect(
            page.getByRole('cell', { name: '历史未知', exact: true }).first(),
          ).toBeVisible()
        await expect(page.locator('.el-alert--error')).toHaveCount(0)
        return {
          metrics,
          aggregateCurrencies: fees.map((f) => f.currency),
          auditRows: audits.length,
          legacyAuditRows: audits.filter((row) => row.scopeMode === null || row.outcome === null)
            .length,
        }
      })
    else
      checks.push({
        name: '管理员指标、费用聚合和访问审计',
        status: 'SKIP',
        detail: '当前受控账号不是 ADMIN',
      })
  } finally {
    if (token) {
      const logout = await page.request.post('/api/v1/auth/logout', {
        headers: { Authorization: 'Bearer ' + token },
      })
      report.logoutStatus = logout.status()
    }
    report.finishedAt = new Date().toISOString()
    await mkdir('var/live', { recursive: true })
    await writeFile('var/live/observation-2026-10-09.json', JSON.stringify(report, null, 2) + '\n')
  }
  expect(checks.filter((c) => c.status === 'FAIL')).toEqual([])
})
