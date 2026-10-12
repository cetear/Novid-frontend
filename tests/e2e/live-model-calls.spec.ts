import { test, expect } from '@playwright/test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  loginSchema,
  graphSchema,
  spanSchema,
  taskSchema,
} from '../../src/shared/api/contracts/backend'
import { callDetailSchema, payloadPageSchema } from '../../src/shared/api/contracts/modelCalls'
test('真实调用归档：图摘要、独立记录、游标、模型文本、下载和页面', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(240000)
  const fixture = JSON.parse(await readFile('var/live/model-calls-fixture-2026-10-13.json', 'utf8'))
  const trace = fixture.selected.run.traceId
  const checks: unknown[] = []
  let token = ''
  async function api(path: string, expected = 200) {
    const response = await page.request.get('/api/v1' + path, {
      headers: { Authorization: 'Bearer ' + token },
    })
    expect(response.status()).toBe(expected)
    if (expected === 200) expect(response.headers()['cache-control']).toContain('no-store')
    return response
  }
  try {
    await page.goto('/runs/' + trace)
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const auth = page
      .waitForResponse((r) => r.url().endsWith('/auth/login'))
      .then(async (r) => loginSchema.parse(await r.json()))
    await page.getByRole('button', { name: '登录工作台' }).click()
    token = (await auth).token
    await expect(page).toHaveURL(new RegExp('/runs/' + trace + '$'))
    const graph = graphSchema.parse(
      await (await api('/runs/' + trace + '/graph?view=summary')).json(),
    )
    expect(graph.nodes.every((n) => !n.input && !n.output && !n.diagnostic)).toBe(true)
    const calls = z
      .array(callDetailSchema)
      .parse(await (await api('/runs/' + trace + '/calls?page=0&size=20')).json())
    const ready = calls.find((c) => c.input.state === 'READY' && c.output.state === 'READY')!
    expect(ready).toBeTruthy()
    const call = callDetailSchema.parse(
      await (await api('/runs/' + trace + '/calls/' + ready.call.callId)).json(),
    )
    const filtered = z
      .array(callDetailSchema)
      .parse(
        await (
          await api(
            '/runs/' +
              trace +
              '/calls?nodeId=' +
              encodeURIComponent(call.call.context.businessNodeId!) +
              '&page=0&size=20',
          )
        ).json(),
      )
    expect(filtered.some((c) => c.call.callId === call.call.callId)).toBe(true)
    if (call.call.spanId && graph.nodes.some((n) => n.spanId === call.call.spanId)) {
      const node = spanSchema.parse(
        await (await api(`/runs/${trace}/nodes/${call.call.spanId}`)).json(),
      )
      expect(node.spanId).toBe(call.call.spanId)
      checks.push({
        name: 'private node detail',
        spanId: node.spanId,
        callId: node.observation?.callId,
      })
    }
    const task = taskSchema.parse(await (await api('/tasks/' + fixture.taskId)).json())
    checks.push({
      name: 'task final state',
      status: task.status,
      errorCode: task.errorCode,
      attempts: task.modelAttempts,
    })
    await api('/runs/' + trace + '/calls?size=51', 400)
    await api(`/runs/${trace}/calls/${call.call.callId}/payloads/INPUT?cursor=%25invalid`, 400)
    checks.push({
      name: 'summary/detail/filter/size',
      nodeCount: graph.nodes.length,
      calls: calls.length,
      callId: call.call.callId,
      callStatus: call.call.callStatus,
      validationStatus: call.call.validationStatus,
    })
    for (const side of ['INPUT', 'OUTPUT'] as const) {
      let cursor: string | null = null,
        full = '',
        count = 0
      do {
        const path =
          `/runs/${trace}/calls/${call.call.callId}/payloads/${side}?limit=1024&view=raw` +
          (cursor === null ? '' : '&cursor=' + encodeURIComponent(cursor))
        const body = payloadPageSchema.parse(await (await api(path)).json())
        full += body.content
        cursor = body.nextCursor
        count++
        expect(count).toBeLessThan(1024)
      } while (cursor !== null)
      const download = await api(
        `/runs/${trace}/calls/${call.call.callId}/payloads/${side}/download`,
      )
      const bytes = await download.body()
      expect(bytes.toString('utf8')).toBe(full)
      expect(full.length).toBe(call[side === 'INPUT' ? 'input' : 'output'].charCount)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        call[side === 'INPUT' ? 'input' : 'output'].checksum,
      )
      checks.push({
        name: side + ' raw pages and download',
        pages: count,
        bytes: bytes.length,
        chars: full.length,
        checksum: call[side === 'INPUT' ? 'input' : 'output'].checksum,
      })
    }
    const model = payloadPageSchema.parse(
      await (
        await api(`/runs/${trace}/calls/${call.call.callId}/payloads/OUTPUT?view=model&limit=8192`)
      ).json(),
    )
    expect(model.content.length).toBeGreaterThan(0)
    checks.push({
      name: 'model text extraction',
      contentKind: model.contentKind,
      chars: model.content.length,
    })
    const unavailable = calls.find((c) => c.input.state !== 'READY')
    if (unavailable) {
      const response = await api(
        `/runs/${trace}/calls/${unavailable.call.callId}/payloads/INPUT`,
        409,
      )
      expect((await response.json()).code).toBe('MODEL_CALL_PAYLOAD_UNAVAILABLE')
      checks.push({
        name: 'unavailable distinct from empty',
        state: unavailable.input.state,
        status: 409,
      })
    }
    await page.getByRole('button', { name: '查询模型调用', exact: true }).click()
    await page.getByRole('button', { name: '查看调用 ' + call.call.callId, exact: true }).click()
    await expect(page.locator('.call-detail')).toContainText('提供方调用：' + call.call.callStatus)
    await expect(page.locator('.call-detail')).toContainText('完整归档')
    await page.getByRole('button', { name: '读取正文首页' }).click()
    await expect(page.locator('.payload-text')).not.toBeEmpty()
    await page.getByLabel('正文方向').selectOption('OUTPUT')
    await page.getByLabel('响应展示').selectOption('model')
    await expect(page.locator('.payload-text')).toContainText(model.content.slice(0, 80))
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    checks.push({ name: 'real page and mobile', passed: true })
  } finally {
    if (token)
      expect(
        (
          await page.request.post('/api/v1/auth/logout', {
            headers: { Authorization: 'Bearer ' + token },
          })
        ).status(),
      ).toBe(200)
    await mkdir('var/live', { recursive: true })
    await writeFile(
      'var/live/model-calls-verification-2026-10-13.json',
      JSON.stringify(
        { trace, taskId: fixture.taskId, checks, checkedAt: new Date().toISOString() },
        null,
        2,
      ),
    )
  }
})
