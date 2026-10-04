import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  loginSchema,
  baseSchema,
  documentSchema,
  ingestionSchema,
  sessionSchema,
  sessionMessageSchema,
  graphSchema,
} from '../../src/shared/api/contracts/backend'

test('真实后端：SSE 完整交付和只读工具历史复测', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(240_000)
  const report: Record<string, unknown> = { startedAt: new Date().toISOString() }
  let token = '',
    baseId = 0,
    sessionId = 0
  const cleanup: string[] = []
  async function api(path: string, method = 'GET', data?: unknown, status = 200, key?: string) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      timeout: 90_000,
      headers: { Authorization: 'Bearer ' + token, ...(key ? { 'Idempotency-Key': key } : {}) },
    })
    if (response.status() !== status) {
      const error = await response.json().catch(() => ({}))
      throw new Error(
        `${method} ${path}: HTTP ${response.status()} / ${error.code ?? 'HTTP_ERROR'}`,
      )
    }
    return response
  }
  try {
    await page.goto('/login')
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const login = page.waitForResponse(
      (response) =>
        response.url().endsWith('/auth/login') && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '登录工作台' }).click()
    const response = await login
    expect(response.status()).toBe(200)
    token = loginSchema.parse(await response.json()).token
    await expect(page).toHaveURL(/\/chat$/)
    const name = 'sse-live-' + crypto.randomUUID().slice(0, 8)
    const base = baseSchema.parse(
      await (
        await api('/knowledge-bases', 'POST', { name, description: '独立 SSE 复测合成资料' })
      ).json(),
    )
    baseId = base.id
    report.baseId = baseId
    const uploaded = await page.request.post('/api/v1/documents', {
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': crypto.randomUUID() },
      multipart: {
        knowledgeBaseId: String(baseId),
        file: {
          name: 'sse-probe.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from(
            '# 一叶项目\n\n项目代号为曦光，项目编号为 LIVE-1427。本资料仅为合成联调输入。',
            'utf8',
          ),
        },
      },
    })
    expect(uploaded.status()).toBe(202)
    const document = documentSchema.parse(await uploaded.json())
    report.documentId = document.id
    await expect
      .poll(
        async () => {
          const ingestion = ingestionSchema.parse(
            await (await api('/documents/' + document.id + '/ingestion')).json(),
          )
          if (ingestion.status === 'FAILED') throw new Error('入库失败：' + ingestion.errorCode)
          return ingestion.status
        },
        { timeout: 120_000, intervals: [2000] },
      )
      .toBe('READY')
    await page.locator('.scope-mode .el-select__wrapper').click()
    await page.getByRole('option', { name: '指定知识库', exact: true }).click()
    await page.getByLabel('知识库 ID', { exact: true }).fill(String(baseId))
    await page.getByRole('button', { name: '应用范围', exact: true }).click()
    await page.getByLabel('新会话标题').fill(name)
    const created = page.waitForResponse(
      (value) => value.url().endsWith('/sessions') && value.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    expect((await created).status()).toBe(201)
    await expect(page.locator('.session-panel')).toContainText(/会话 #\d+ · 版本/)
    sessionId = Number(
      (await page.locator('.session-panel').textContent())!.match(/会话 #(\d+) · 版本/)![1],
    )
    report.sessionId = sessionId
    await page.getByLabel('模型配置', { exact: true }).selectOption('knowledge')
    await page.getByLabel('工具续轮', { exact: true }).selectOption('READ_ONLY')
    await page
      .getByLabel('你的问题')
      .fill('请调用 search_knowledge 只读工具核对资料，告诉我项目代号和编号，并提供引用。')
    const stream = page.waitForResponse(
      (value) => value.url().endsWith('/chat/stream') && value.request().method() === 'POST',
      { timeout: 90_000 },
    )
    await page.getByRole('button', { name: '发送问题' }).click()
    const streamed = await stream
    report.httpStatus = streamed.status()
    expect(streamed.status()).toBe(200)
    expect(streamed.headers()['content-type']).toContain('text/event-stream')
    await expect(page.getByRole('button', { name: '停止阅读', exact: true })).toHaveCount(0, {
      timeout: 90_000,
    })
    await expect(page.getByText('完整交付', { exact: true })).toBeVisible()
    await expect(page.locator('.chat-exchange .markdown')).toContainText('LIVE-1427')
    await expect(page.locator('.answer-footer')).not.toContainText('测试结果')
    await expect(page.getByLabel('你的问题')).toHaveValue('')
    await expect(page.getByRole('button', { name: '发送问题' })).toBeDisabled()
    const citations = page.locator('.citations button')
    expect(await citations.count()).toBeGreaterThan(0)
    await citations.first().click()
    await expect(page.locator('.el-drawer')).toContainText('LIVE-1427')
    await page.locator('.el-drawer__close-btn').click()
    const session = sessionSchema.parse(await (await api('/sessions/' + sessionId)).json())
    expect(session.version).toBeGreaterThan(1)
    const history = z
      .array(sessionMessageSchema)
      .parse(await (await api(`/sessions/${sessionId}/messages?afterSeq=0&size=100`)).json())
    const requests = history.filter((event) => event.role === 'TOOL_REQUEST'),
      results = history.filter((event) => event.role === 'TOOL_RESULT')
    expect(requests.length).toBeGreaterThan(0)
    for (const event of requests)
      expect(
        results.filter(
          (result) => result.toolCallId === event.toolCallId && result.toolName === event.toolName,
        ),
      ).toHaveLength(1)
    expect(
      history.some((event) => event.role === 'ASSISTANT' && event.content?.includes('LIVE-1427')),
    ).toBe(true)
    const traceId = decodeURIComponent(
      (await page.locator('.answer-footer a').first().getAttribute('href'))!.split('/').pop()!,
    )
    let graph = graphSchema.parse(await (await api('/runs/' + traceId + '/graph')).json())
    for (let i = 0; !graph.nodes.length && i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      graph = graphSchema.parse(await (await api('/runs/' + traceId + '/graph')).json())
    }
    expect(graph.run.mock).toBe(false)
    expect(graph.nodes.some((node) => node.type === 'MODEL')).toBe(true)
    report.result = {
      status: 'PASS',
      realAnswerVerified: true,
      citationCount: await citations.count(),
      sessionVersion: session.version,
      historyEvents: history.length,
      toolRequests: requests.length,
      toolResults: results.length,
      matchedPairs: true,
      traceId,
      graphNodes: graph.nodes.length,
      graphIncomplete: graph.incomplete,
      knownUsage: graph.nodes
        .filter((node) => node.type === 'MODEL')
        .map((node) => ({
          inputTokens: node.inputTokens,
          outputTokens: node.outputTokens,
          usageSource: node.usageSource,
        })),
    }
  } finally {
    if (sessionId) {
      try {
        const value = sessionSchema.parse(await (await api('/sessions/' + sessionId)).json())
        await api('/sessions/' + sessionId + '?version=' + value.version, 'DELETE', undefined, 204)
        cleanup.push('会话已删除')
      } catch {
        cleanup.push('会话清理未确认')
      }
    }
    if (baseId) {
      try {
        const value = baseSchema.parse(await (await api('/knowledge-bases/' + baseId)).json())
        await api('/knowledge-bases/' + baseId + '?version=' + value.version, 'DELETE')
        cleanup.push('知识库及文档已逻辑删除')
      } catch {
        cleanup.push('资料清理未确认')
      }
    }
    if (token) {
      try {
        await api('/auth/logout', 'POST')
        cleanup.push('令牌已撤销')
      } catch {
        cleanup.push('令牌撤销未确认')
      }
    }
    report.cleanup = cleanup
    report.finishedAt = new Date().toISOString()
    await mkdir('var/live', { recursive: true })
    await writeFile('var/live/sse-verified-2026-10-04.json', JSON.stringify(report, null, 2) + '\n')
  }
  expect(cleanup.some((item) => item.includes('未确认'))).toBe(false)
})
