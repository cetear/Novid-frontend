import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { loginSchema, baseSchema, taskSchema } from '../../src/shared/api/contracts/backend'
import { callDetailSchema } from '../../src/shared/api/contracts/modelCalls'
test('真实来源撤销：隐藏私有正文并清理本轮合成资料', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(120000)
  const fixture = JSON.parse(await readFile('var/live/model-calls-fixture-2026-10-13.json', 'utf8'))
  expect(fixture.synthetic).toBe(true)
  const trace = fixture.selected.run.traceId
  const checks: unknown[] = []
  let token = ''
  try {
    await page.goto('/runs/' + trace)
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const login = page
      .waitForResponse((r) => r.url().endsWith('/auth/login'))
      .then(async (r) => loginSchema.parse(await r.json()))
    await page.getByRole('button', { name: '登录工作台' }).click()
    token = (await login).token
    const headers = { Authorization: 'Bearer ' + token }
    const task = taskSchema.parse(
      await (await page.request.get('/api/v1/tasks/' + fixture.taskId, { headers })).json(),
    )
    checks.push({
      name: 'final task',
      status: task.status,
      errorCode: task.errorCode,
      attempts: task.modelAttempts,
    })
    if (['RUNNING', 'QUEUED', 'PAUSED'].includes(task.status)) {
      expect(
        (
          await page.request.post('/api/v1/tasks/' + fixture.taskId + '/actions', {
            headers,
            data: { action: 'cancel' },
          })
        ).status(),
      ).toBe(200)
    }
    const before = z
      .array(callDetailSchema)
      .parse(
        await (await page.request.get(`/api/v1/runs/${trace}/calls?size=20`, { headers })).json(),
      )
    const call = before.find((c) => c.call.callId === fixture.selected.calls[0].call.callId)!
    await page.getByRole('button', { name: '查询模型调用', exact: true }).click()
    await page.getByRole('button', { name: '查看调用 ' + call.call.callId, exact: true }).click()
    if (call.input.state === 'READY') {
      const base = baseSchema.parse(
        await (
          await page.request.get('/api/v1/knowledge-bases/' + fixture.baseId, { headers })
        ).json(),
      )
      expect(base.name.startsWith('call-archive-')).toBe(true)
      await page.getByRole('button', { name: '读取正文首页' }).click()
      await expect(page.locator('.payload-text')).not.toBeEmpty()
      expect(
        (
          await page.request.delete(
            '/api/v1/knowledge-bases/' + base.id + '?version=' + base.version,
            { headers },
          )
        ).status(),
      ).toBe(200)
    } else {
      expect(call.input.state).toBe('ACCESS_REVOKED')
    }
    checks.push({
      name: 'synthetic source cleanup',
      baseId: fixture.baseId,
      documentId: fixture.documentId,
      status: 200,
      alreadyRevoked: call.input.state === 'ACCESS_REVOKED',
    })
    await page.getByRole('button', { name: '重新核验调用' }).click()
    await expect(page.locator('.payload-text')).toHaveCount(0)
    await expect(page.locator('.diagnostic')).toHaveCount(0)
    await expect(page.locator('.call-detail')).toContainText('访问已撤销')
    await expect(page.getByRole('button', { name: '读取正文首页' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '下载请求原始正文' })).toBeDisabled()
    const after = callDetailSchema.parse(
      await (
        await page.request.get(`/api/v1/runs/${trace}/calls/${call.call.callId}`, { headers })
      ).json(),
    )
    expect(after.input.state).toBe('ACCESS_REVOKED')
    expect(after.input.preview).toBeNull()
    expect(after.call.diagnostic).toBeNull()
    for (const [suffix, status] of [
      ['INPUT?limit=8192', 403],
      ['OUTPUT/download', 409],
    ] as const) {
      expect(
        (
          await page.request.get(
            `/api/v1/runs/${trace}/calls/${call.call.callId}/payloads/` + suffix,
            { headers },
          )
        ).status(),
      ).toBe(status)
    }
    checks.push({
      name: 'revoked API and page',
      states: [after.input.state, after.output.state],
      payloadStatus: 403,
      downloadStatus: 409,
    })
  } finally {
    if (token)
      expect(
        (
          await page.request.post('/api/v1/auth/logout', {
            headers: { Authorization: 'Bearer ' + token },
          })
        ).status(),
      ).toBe(200)
    await writeFile(
      'var/live/model-calls-cleanup-2026-10-13.json',
      JSON.stringify(
        { trace, taskId: fixture.taskId, checks, checkedAt: new Date().toISOString() },
        null,
        2,
      ),
    )
  }
})
