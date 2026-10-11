import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { loginSchema, taskSchema, contentSchema } from '../../src/shared/api/contracts/backend'
import {
  compilationSaveSchema,
  originSchema,
  participationSchema,
} from '../../src/shared/api/contracts/workflow'
import { z } from 'zod'
test('真实 V3 同批产物复核：深链接重新登录、整编确认保存和来源绑定', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(3600000)
  let token = ''
  const tokens: string[] = [],
    checks: unknown[] = [],
    evidence: Record<string, unknown> = {
      startedAt: new Date().toISOString(),
      checks,
      realServices: true,
    }
  async function source() {
    return JSON.parse(await readFile('var/live/v3-2026-10-11.json', 'utf8'))
  }
  async function save() {
    await writeFile('var/live/v3-readback-2026-10-11.json', JSON.stringify(evidence, null, 2))
  }
  async function api(path: string, method = 'GET', data?: unknown, expected = 200) {
    const r = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      timeout: 90000,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
    })
    expect(r.status(), method + ' ' + path).toBe(expected)
    return r
  }
  async function loginAt(path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page
      .getByLabel('用户名', { exact: true })
      .fill(process.env.NOVID_TEST_USERNAME!, { timeout: 60000 })
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const result = page
      .waitForResponse((r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST')
      .then(async (r) => loginSchema.parse(await r.json()))
    await page.getByRole('button', { name: '登录工作台' }).click()
    token = (await result).token
    tokens.push(token)
  }
  try {
    const initial = await source()
    expect(initial.tasks.length).toBeGreaterThan(0)
    evidence.marker = initial.marker
    await loginAt('/tasks/' + initial.tasks[0])
    console.info('[V3 复核] 已重新登录任务深链接')
    await expect
      .poll(
        async () => taskSchema.parse(await (await api('/tasks/' + initial.tasks[0])).json()).status,
        { timeout: 1800000, intervals: [5000] },
      )
      .toMatch(/SUCCEEDED|FAILED/)
    const quiz = taskSchema.parse(await (await api('/tasks/' + initial.tasks[0])).json())
    evidence.quiz = quiz
    if (quiz.status === 'SUCCEEDED') {
      await page.getByRole('button', { name: '刷新状态', exact: true }).click()
      await page.getByRole('button', { name: '核验并查看学习结果' }).click()
      await expect(page.locator('.learning-result')).toBeVisible()
      await expect(page.locator('.content-plan')).toContainText('章节验收')
      await page.getByRole('button', { name: '核验阅读与工作包' }).click()
      await expect(page.getByText('完整读取已确认', { exact: false })).toBeVisible()
      checks.push({ name: '真实自测结果与 V3 诊断页面', status: 'PASS' })
      await save()
    }
    await expect
      .poll(
        async () => {
          const current = await source()
          const failedCompilation = current.tasks.some((id: number) => {
            const task = current['task' + id]
            return task?.taskType === 'KNOWLEDGE_COMPILATION' && task.status === 'FAILED'
          })
          return (
            current.saveApproval ??
            (current.finishedAt || failedCompilation ? 'NO_APPROVAL' : 'WAITING')
          )
        },
        { timeout: 1800000, intervals: [5000] },
      )
      .not.toBe('WAITING')
    const current = await source()
    expect(current.saveApproval, '整编必须成功才能真实保存').toBeTruthy()
    evidence.approvalId = current.saveApproval
    await loginAt('/approvals/' + current.saveApproval + '?compilationSave=1')
    await page.getByRole('button', { name: '已核对，批准保存' }).click()
    await expect(
      page.getByText('笔记已保存为文档；索引仍需后台处理。', { exact: true }),
    ).toBeVisible({ timeout: 60000 })
    const saved = compilationSaveSchema.parse(
      await (await api('/compilation-saves/' + current.saveApproval)).json(),
    )
    expect(saved.document).not.toBeNull()
    evidence.savedDocumentId = saved.document!.id
    await expect
      .poll(
        async () =>
          contentSchema.parse(await (await api('/documents/' + saved.document!.id)).json()).document
            .ingestionStatus,
        { timeout: 300000, intervals: [3000] },
      )
      .toBe('READY')
    await expect(page.getByRole('link', { name: '使用已保存文档发起自测 →' })).toBeVisible({
      timeout: 30000,
    })
    const origin = originSchema.parse(
      await (await api('/documents/' + saved.document!.id + '/origin')).json(),
    )
    evidence.origin = origin
    expect(origin.originType).toBe('KNOWLEDGE_COMPILATION')
    expect(origin.bindingStatus).toBe('BOUND')
    expect(origin.mappingValid).toBe(true)
    const participation = z
      .array(participationSchema)
      .parse(
        await (
          await api('/documents/' + current.documentId + '/compilations?page=0&size=20')
        ).json(),
      )
    expect(participation.some((p) => p.documentId === saved.document!.id)).toBe(true)
    evidence.participation = participation
    await page.getByRole('link', { name: '使用已保存文档发起自测 →' }).click()
    await expect(
      page.getByText('选中文档 ID：' + saved.document!.id, { exact: false }),
    ).toBeVisible()
    checks.push({
      name: '既有整编确认保存、READY、BOUND、关联关系和单文档自测入口',
      status: 'PASS',
    })
    await save()
    console.info('[V3 复核] 整编保存与来源绑定通过')
  } catch (e) {
    evidence.error = e instanceof Error ? e.message.slice(0, 2000) : '失败'
    throw e
  } finally {
    const cleanup = []
    for (const value of tokens)
      try {
        const r = await page.request.post('/api/v1/auth/logout', {
          headers: { Authorization: 'Bearer ' + value },
        })
        cleanup.push({ token: r.status() === 200 ? 'REVOKED' : '未确认' })
      } catch {
        cleanup.push({ token: '未确认' })
      }
    evidence.cleanup = cleanup
    evidence.finishedAt = new Date().toISOString()
    await save()
  }
})
