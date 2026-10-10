import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  loginSchema,
  baseSchema,
  contentSchema,
  taskSchema,
  graphSchema,
} from '../../src/shared/api/contracts/backend'
import { contentPlanSchema } from '../../src/shared/api/contracts/contentPlan'
import { learningResultSchema } from '../../src/shared/api/contracts/learning'
import { previewSchema } from '../../src/shared/api/contracts/media'

test('真实 V2：自动规划自测、整编与 PPT，内容计划和运行图', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(2_700_000)
  const compilationOnly = process.env.NOVID_V2_COMPILATION_ONLY === '1'
  const taskTypes = compilationOnly
    ? ['KNOWLEDGE_COMPILATION' as const]
    : (['QUIZ_GENERATION', 'KNOWLEDGE_COMPILATION', 'NOTES_PPT'] as const)
  page.setDefaultTimeout(20_000)
  const marker = 'v2-' + crypto.randomUUID().slice(0, 8)
  const source =
    '# 晨星备份\n\n晨星项目编号 NVD-7319。每周三 21:30 备份。\n\n## 恢复检查\n恢复后先核对校验和，再核对文档数量，两项均一致才标记恢复通过。\n\n这份文档为前端联调合成输入。'
  const checks: Array<{ name: string; status: string; detail: unknown }> = []
  const cleanup: Array<{ resource: string; id?: number; status: string }> = [],
    ids: number[] = []
  const evidence: Record<string, unknown> = {
    marker,
    startedAt: new Date().toISOString(),
    checks,
    cleanup,
    tasks: ids,
    realServices: true,
  }
  let token = '',
    baseId = 0,
    documentId = 0
  async function save() {
    await mkdir('var/live', { recursive: true })
    await writeFile(
      compilationOnly ? 'var/live/v2-compilation-2026-10-09.json' : 'var/live/v2-2026-10-09.json',
      JSON.stringify(evidence, null, 2) + '\n',
    )
  }
  async function api(path: string, method = 'GET', data?: unknown, expected = 200) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      timeout: 90_000,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
    })
    if (response.status() !== expected) {
      const body = await response.json().catch(() => ({}))
      throw new Error(
        `${method} ${path}: HTTP ${response.status()} / ${body.code ?? 'HTTP_ERROR'} (request ${response.headers()['x-request-id'] ?? 'unknown'})`,
      )
    }
    return response
  }
  async function check(name: string, action: () => Promise<unknown>) {
    console.info('[真实 V2] ' + name)
    try {
      checks.push({ name, status: 'PASS', detail: await action() })
    } catch (e) {
      checks.push({
        name,
        status: 'FAIL',
        detail: e instanceof Error ? e.message.slice(0, 1200) : '检查失败',
      })
    }
    await save()
  }
  try {
    const health = await page.request.get('/actuator/health')
    expect(health.status(), '8080 后端及同源代理必须可用').toBe(200)
    expect((await health.json()).status).toBe('UP')
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page
      .getByLabel('用户名', { exact: true })
      .fill(process.env.NOVID_TEST_USERNAME!, { timeout: 60_000 })
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const login = page.waitForResponse(
      (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '登录工作台' }).click()
    const loginResponse = await login
    expect(loginResponse.status(), '受控登录必须成功').toBe(200)
    const identity = loginSchema.parse(await loginResponse.json())
    token = identity.token
    expect(identity.user.passwordChangeRequired).toBe(false)
    const base = baseSchema.parse(
      await (
        await api('/knowledge-bases', 'POST', {
          name: marker,
          description: 'V2 合成资料验收，结束后清理',
        })
      ).json(),
    )
    baseId = base.id
    const upload = await page.request.post('/api/v1/documents', {
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': crypto.randomUUID() },
      multipart: {
        knowledgeBaseId: String(baseId),
        file: { name: marker + '.md', mimeType: 'text/markdown', buffer: Buffer.from(source) },
      },
    })
    expect(upload.status()).toBe(202)
    documentId = (await upload.json()).id
    evidence.baseId = baseId
    evidence.documentId = documentId
    await save()
    await check('真实资料入库', async () => {
      await expect
        .poll(
          async () =>
            contentSchema.parse(await (await api('/documents/' + documentId)).json()).document
              .ingestionStatus,
          { timeout: 180_000, intervals: [3000] },
        )
        .toBe('READY')
      return { baseId, documentId }
    })
    for (const taskType of taskTypes) {
      await check('浏览器创建 ' + taskType, async () => {
        await page.getByRole('link', { name: '学习与制作', exact: true }).click()
        await page
          .getByRole('radio', {
            name: {
              QUIZ_GENERATION: '学习自测',
              KNOWLEDGE_COMPILATION: '资料整编',
              NOTES_PPT: '演示文稿',
            }[taskType],
            exact: true,
          })
          .locator('..')
          .click()
        await expect(page.getByLabel('主题', { exact: true })).toHaveCount(0)
        await page.locator('.scope-mode .el-select__wrapper').click()
        await page.getByRole('option', { name: '指定知识库', exact: true }).click()
        await page.getByLabel('知识库 ID', { exact: true }).fill(String(baseId))
        await page.getByRole('button', { name: '应用范围', exact: true }).click()
        const remarks =
          taskType === 'QUIZ_GENERATION'
            ? '面向初学者，生成恰好 2 道题，依据所选资料。'
            : taskType === 'NOTES_PPT'
              ? '用于课堂讲解，不需要配图，只依据资料。'
              : compilationOnly
                ? '用于快速复习，整编为恰好一章、一节；合并相关事实，保留项目编号、备份时间与恢复检查要求。'
                : ''
        await page.getByLabel('备注（可选）', { exact: true }).fill(remarks)
        const countLabel =
          taskType === 'QUIZ_GENERATION'
            ? '题目数量'
            : taskType === 'KNOWLEDGE_COMPILATION'
              ? '章节上限'
              : '演示文稿总页数'
        await expect(page.getByLabel(countLabel, { exact: true })).toHaveValue('0')
        await page
          .locator('.document-choice')
          .filter({ hasText: marker + '.md' })
          .locator('.el-checkbox')
          .click()
        const pending = page.waitForResponse(
          (r) => r.url().endsWith('/tasks') && r.request().method() === 'POST',
        )
        await page
          .getByRole('button', {
            name: taskType === 'NOTES_PPT' ? '创建媒体任务 →' : '创建学习任务 →',
            exact: true,
          })
          .click()
        const response = await pending
        const body = response.request().postDataJSON()
        expect(body).not.toHaveProperty('topic')
        expect(body).not.toHaveProperty('requestVersion')
        expect(body.strategy).toBe('FIXED')
        if (remarks) expect(body.remarks).toBe(remarks)
        else expect(body).not.toHaveProperty('remarks')
        expect(response.status()).toBe(202)
        await expect(page).toHaveURL(/\/tasks\/\d+$/)
        const createdId = Number(new URL(page.url()).pathname.split('/').pop())
        const task = taskSchema.parse(await (await api('/tasks/' + createdId)).json())
        ids.push(task.taskId)
        evidence['type' + task.taskId] = taskType
        await expect(page).toHaveURL(new RegExp('/tasks/' + task.taskId + '$'))
        return { taskId: task.taskId, taskType, autoCount: true, remarks: !!remarks }
      })
    }
    const deadline = Date.now() + 1_800_000
    const pending = new Set(ids)
    while (pending.size && Date.now() < deadline) {
      for (const id of pending) {
        const task = taskSchema.parse(await (await api('/tasks/' + id)).json())
        evidence['task' + id] = task
        const planResponse = await page.request.get('/api/v1/tasks/' + id + '/content-plan', {
          headers: { Authorization: 'Bearer ' + token },
        })
        expect([200, 204]).toContain(planResponse.status())
        if (planResponse.status() === 200) evidence['plan' + id] = await planResponse.json()
        if (!['QUEUED', 'RUNNING'].includes(task.status)) pending.delete(id)
      }
      await save()
      if (pending.size) await new Promise((resolve) => setTimeout(resolve, 5000))
    }
    for (const id of ids)
      await check('真实结果 ' + id, async () => {
        const task = taskSchema.parse(await (await api('/tasks/' + id)).json())
        if (['QUEUED', 'RUNNING'].includes(task.status))
          throw new Error(
            '观察窗口已结束，任务仍为 ' +
              task.status +
              '，阶段 ' +
              task.progress?.stage +
              '；不能认定后端生成失败。',
          )
        expect(task.status, `${task.taskType}: ${task.errorCode}`).toBe(
          task.taskType === 'NOTES_PPT' ? 'WAITING_APPROVAL' : 'SUCCEEDED',
        )
        const response = await api('/tasks/' + id + '/content-plan')
        expect(response.headers()['cache-control']).toContain('no-store')
        const plan = contentPlanSchema.parse(await response.json())
        evidence['plan' + id] = plan
        expect(plan.fullSourceRead).toBe(true)
        expect(plan.completedUnits).toBe(plan.plan.units.length)
        await page.getByRole('link', { name: '学习与制作', exact: true }).click()
        await page.getByLabel('已知任务 ID').fill(String(id))
        await page.getByRole('button', { name: '打开', exact: true }).click()
        await expect(page.locator('.content-plan')).toContainText(plan.plan.intent.title)
        if (task.taskType === 'NOTES_PPT') {
          const preview = previewSchema.parse(await (await api('/tasks/' + id + '/preview')).json())
          expect(preview.contentPlan?.planHash).toBe(plan.planHash)
          expect(preview.units.length).toBe(plan.plan.counts.contentSlides)
          expect(preview.contentPlan?.totalSlides).toBe(plan.plan.counts.totalSlides)
          await expect(page.locator('.media-workbench')).toContainText(
            '总计 ' + plan.plan.counts.totalSlides + ' 页',
          )
          expect(await (await api('/tasks/' + id + '/media-plans')).json()).toEqual([])
          evidence['preview' + id] = {
            contentPlan: preview.contentPlan,
            units: preview.units.length,
          }
        } else {
          const result = learningResultSchema.parse(
            await (await api('/tasks/' + id + '/result')).json(),
          )
          expect(result.contentPlan).toEqual(plan.plan)
          if (task.taskType === 'QUIZ_GENERATION') {
            expect(result.quiz?.questions).toHaveLength(2)
            expect(plan.plan.counts.questions).toBe(2)
          } else {
            expect(result.chapters.length).toBe(plan.plan.counts.chapters)
            expect(result.chapters.flatMap((c) => c.sections).length).toBe(
              plan.plan.counts.sections,
            )
          }
          await page.getByRole('button', { name: '核验并查看学习结果', exact: true }).click()
          await expect(page.locator('.learning-result')).toContainText(result.title)
          const artifact = await api('/artifacts/' + task.artifactId)
          expect(await artifact.text()).toContain('NVD-7319')
        }
        return {
          taskId: id,
          status: task.status,
          counts: plan.plan.counts,
          completedUnits: plan.completedUnits,
          fullSourceRead: plan.fullSourceRead,
        }
      })
    await check('持久运行图', async () => {
      const runs = (await (await api('/runs?page=0&size=100')).json()) as Array<{
        taskId: number | null
        traceId: string
      }>
      const graphs = []
      for (const run of runs.filter((r) => r.taskId !== null && ids.includes(r.taskId))) {
        const graph = graphSchema.parse(
          await (await api('/runs/' + encodeURIComponent(run.traceId) + '/graph')).json(),
        )
        evidence.graphDiagnostics = [
          ...((evidence.graphDiagnostics as unknown[]) ?? []),
          {
            taskId: run.taskId,
            traceId: run.traceId,
            nodes: graph.nodes.length,
            incomplete: graph.incomplete,
            telemetryDropped: graph.run.telemetryDropped,
            mock: graph.run.mock,
          },
        ]
        await save()
        expect(graph.nodes.length).toBeGreaterThan(0)
        expect(graph.nodes.some((n) => n.type === 'MODEL')).toBe(true)
        expect(graph.run.mock).toBe(false)
        graphs.push({
          taskId: run.taskId,
          traceId: run.traceId,
          nodes: graph.nodes.length,
          incomplete: graph.incomplete,
        })
      }
      expect(graphs.length).toBeGreaterThanOrEqual(ids.length)
      return graphs
    })
  } catch (e) {
    checks.push({
      name: '环境或主流程',
      status: 'FAIL',
      detail: e instanceof Error ? e.message.slice(0, 1200) : '执行中断',
    })
  } finally {
    for (const id of ids)
      try {
        const task = taskSchema.parse(await (await api('/tasks/' + id)).json())
        if (
          [
            'QUEUED',
            'RUNNING',
            'PAUSED',
            'WAITING_APPROVAL',
            'WAITING_EXTERNAL',
            'WAITING_MEDIA_REVIEW',
            'NEEDS_RECONCILIATION',
          ].includes(task.status)
        )
          await api('/tasks/' + id + '/actions', 'POST', { action: 'cancel' })
        const final = taskSchema.parse(await (await api('/tasks/' + id)).json())
        evidence['finalTask' + id] = final
        cleanup.push({ resource: 'task', id, status: final.status + '；无删除接口' })
      } catch {
        cleanup.push({ resource: 'task', id, status: '清理未确认' })
      }
    if (baseId)
      try {
        const base = baseSchema.parse(await (await api('/knowledge-bases/' + baseId)).json())
        await api('/knowledge-bases/' + baseId + '?version=' + base.version, 'DELETE')
        cleanup.push({ resource: 'base-and-document', id: baseId, status: '逻辑删除' })
      } catch {
        cleanup.push({ resource: 'base-and-document', id: baseId, status: '清理未确认' })
      }
    if (token)
      try {
        await api('/auth/logout', 'POST')
        cleanup.push({ resource: 'token', status: 'REVOKED' })
      } catch {
        cleanup.push({ resource: 'token', status: '撤销未确认' })
      }
    evidence.finishedAt = new Date().toISOString()
    await save()
  }
  expect(checks.filter((c) => c.status === 'FAIL')).toEqual([])
  expect(ids).toHaveLength(taskTypes.length)
  expect(cleanup.some((entry) => entry.status.includes('未确认'))).toBe(false)
})
