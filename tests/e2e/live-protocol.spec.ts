import { test, expect, type APIResponse } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  loginSchema,
  baseSchema,
  contentSchema,
  ingestionSchema,
  sectionSchema,
  sectionPageSchema,
  chunkSchema,
  aiSchema,
  sessionSchema,
  sessionMessageSchema,
  approvalSchema,
  taskSchema,
  planSchema,
  graphSchema,
  toolSchema,
  type AiResult,
  type TaskSnapshot,
} from '../../src/shared/api/contracts/backend'
import { z } from 'zod'

test('真实后端：S01–S06 入库、真实模型、会话、笔记、报告与运行图', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(900_000)
  page.setDefaultTimeout(20_000)
  const marker = 'front-' + crypto.randomUUID().slice(0, 8)
  const title = '晨星-' + marker
  const raw =
    '# 晨星项目\n\n项目代号为晨星，编号为 NVD-7319。备份在每周三 21:30 执行。\n\n## 恢复验证\n恢复后须核对校验和，再核对文档数量。只将校验和与数量均一致的恢复标记为通过。\n\n## 联调边界\n这份文档和问题仅为合成验收输入，不含真实业务资料或秘密。'
  const evidencePath = 'var/live/protocol-2026-10-04.json'
  const checks: Array<{ name: string; status: string; detail?: unknown }> = []
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    marker,
    checks,
    realServices: true,
  }
  const cleanup: Array<{ resource: string; id?: number | string; status: string }> = []
  const approvals: string[] = []
  const tasks: number[] = [],
    sessions: number[] = [],
    traces = new Set<string>()
  let token = '',
    baseId = 0,
    documentId = 0
  let answer: AiResult | null = null
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 200)))
  async function save() {
    await mkdir('var/live', { recursive: true })
    await writeFile(evidencePath, JSON.stringify(report, null, 2) + '\n')
  }
  async function check(name: string, work: () => Promise<unknown>, fatal = false) {
    console.info('[真实联调] ' + name)
    try {
      const detail = await test.step(name, work)
      checks.push({ name, status: 'PASS', detail })
    } catch (e) {
      checks.push({
        name,
        status: 'FAIL',
        detail: e instanceof Error ? e.message.slice(0, 700) : '检查失败',
      })
      await save()
      if (fatal) throw e
    }
    await save()
  }
  async function api(
    path: string,
    method = 'GET',
    data?: unknown,
    status = 200,
    key?: string,
  ): Promise<APIResponse> {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      timeout: 90_000,
      headers: { Authorization: 'Bearer ' + token, ...(key ? { 'Idempotency-Key': key } : {}) },
    })
    if (response.status() !== status) {
      const detail = await response.json().catch(() => ({}))
      throw new Error(
        `${method} ${path}: HTTP ${response.status()} / ${typeof detail.code === 'string' ? detail.code : 'HTTP_ERROR'}，预期 ${status}`,
      )
    }
    return response
  }
  async function openBase() {
    await page.getByRole('link', { name: '知识库', exact: true }).click()
    await page.getByLabel('已知知识库 ID').fill(String(baseId))
    await page.locator('.recovery-panel').getByRole('button', { name: '打开', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/knowledge-bases/' + baseId + '$'))
  }
  async function applyScope() {
    const chat = await page.locator('.chat-workspace').count()
    if (chat) await page.getByRole('button', { name: '会话设置', exact: true }).click()
    await page.locator('.scope-mode .el-select__wrapper').click()
    await page.getByRole('option', { name: '指定知识库', exact: true }).click()
    await page.getByLabel('知识库 ID', { exact: true }).fill(String(baseId))
    await page.getByRole('button', { name: '应用范围', exact: true }).click()
    if (chat) await page.getByRole('button', { name: '完成设置', exact: true }).click()
  }
  async function taskFinished(id: number) {
    const expires = Date.now() + 360_000
    let previous = ''
    while (Date.now() < expires) {
      const value = taskSchema.parse(await (await api('/tasks/' + id)).json())
      const label = `${value.status}/${value.progress?.stage}/${value.progress?.completedSteps}`
      if (label !== previous) {
        console.info(`[真实任务 #${id}] ${label}`)
        previous = label
        report['task' + id] = {
          status: value.status,
          progress: value.progress,
          errorCode: value.errorCode,
          modelAttempts: value.modelAttempts,
          coverage: value.coverage,
          artifactId: value.artifactId,
        }
        await save()
      }
      if (!['QUEUED', 'RUNNING', 'PAUSED'].includes(value.status)) return value
      if (value.progress?.workerEnabled === false)
        throw new Error('报告 Worker 关闭，无法验收真实生成')
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(10_000, Math.max(2000, value.progress?.pollAfterMillis ?? 2000)),
        ),
      )
    }
    throw new Error('报告在六分钟观察窗口内未到终态；未重新创建或重发模型请求')
  }
  const scope = () => ({ mode: 'SELECTED', knowledgeBaseIds: [baseId], ownerUserId: null })
  try {
    await check(
      '健康、同源代理与受控登录',
      async () => {
        const health = await page.request.get('/actuator/health')
        expect(health.status()).toBe(200)
        expect((await health.json()).status).toBe('UP')
        await page.goto('/login')
        await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
        await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
        const pending = page.waitForResponse(
          (response) =>
            response.url().endsWith('/auth/login') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '登录工作台' }).click()
        const response = await pending
        expect(response.status()).toBe(200)
        const identity = loginSchema.parse(await response.json())
        token = identity.token
        expect(identity.user.passwordChangeRequired).toBe(false)
        report.actor = { id: identity.user.id, role: identity.user.role }
        await expect(page).toHaveURL(/\/chat$/)
        return { health: 'UP', role: identity.user.role }
      },
      true,
    )

    await check(
      '浏览器新建合成知识库与 UTF-8 上传',
      async () => {
        await page.getByRole('link', { name: '知识库', exact: true }).click()
        await page.getByRole('button', { name: '新建知识库', exact: true }).click()
        await page.getByLabel('名称', { exact: true }).fill(title)
        await page
          .getByLabel('描述', { exact: true })
          .fill('本次真实联调的独立合成资料，完成后逻辑删除')
        const created = page.waitForResponse(
          (response) =>
            response.url().endsWith('/knowledge-bases') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '创建知识库', exact: true }).click()
        expect((await created).status()).toBe(200)
        await expect(page).toHaveURL(/\/knowledge-bases\/\d+$/)
        baseId = Number(new URL(page.url()).pathname.split('/').pop())
        baseSchema.parse(await (await api('/knowledge-bases/' + baseId)).json())
        report.baseId = baseId
        await expect(page).toHaveURL(new RegExp('/knowledge-bases/' + baseId + '$'))
        await page.getByLabel('上传文档文件').setInputFiles({
          name: marker + '.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from(raw, 'utf8'),
        })
        const pending = page.waitForResponse(
          (response) =>
            response.url().endsWith('/documents') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '上传资料', exact: true }).click()
        const uploaded = await pending
        expect(uploaded.status()).toBe(202)
        await expect(page).toHaveURL(/\/documents\/\d+$/)
        documentId = Number(new URL(page.url()).pathname.split('/').pop())
        const document = contentSchema.parse(
          await (await api('/documents/' + documentId)).json(),
        ).document
        report.documentId = documentId
        await expect(page).toHaveURL(new RegExp('/documents/' + documentId + '$'))
        return { baseId, documentId, acceptedStatus: document.ingestionStatus }
      },
      true,
    )

    await check(
      '真实入库、激活代次、批次事实与章节原文',
      async () => {
        const expires = Date.now() + 180_000
        let previous = ''
        while (true) {
          const value = ingestionSchema.parse(
            await (await api('/documents/' + documentId + '/ingestion')).json(),
          )
          const label = value.status + '/' + value.progress?.phase
          report.ingestion = value
          if (label !== previous) {
            console.info('[真实入库] ' + label)
            previous = label
            await save()
          }
          if (value.status === 'FAILED') throw new Error('真实入库失败：' + value.errorCode)
          if (value.status === 'READY') {
            expect(value.activeProcessingRevision).not.toBeNull()
            break
          }
          if (Date.now() >= expires)
            throw new Error('入库在三分钟观察窗口未就绪，未自动 retry / reprocess')
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        const content = contentSchema.parse(await (await api('/documents/' + documentId)).json())
        expect(content.text).toBe(raw)
        const sections = z
          .array(sectionSchema)
          .parse(await (await api(`/documents/${documentId}/sections?page=0&size=20`)).json())
        expect(sections.length).toBeGreaterThan(0)
        const chunks = z
          .array(chunkSchema)
          .parse(await (await api(`/documents/${documentId}/chunks?page=0&size=20`)).json())
        expect(chunks.length).toBeGreaterThan(0)
        expect(chunks[0]?.sourceMap?.length).toBeGreaterThan(0)
        const section = sectionPageSchema.parse(
          await (
            await api(
              `/documents/${documentId}/sections/${encodeURIComponent(sections[0]!.sectionId)}?documentVersion=${content.document.documentVersion}&processingRevision=${content.document.activeProcessingRevision}&maxTokens=4000`,
            )
          ).json(),
        )
        expect(section.text).toBe(raw.slice(section.startOffset, section.endOffset))
        await page.getByRole('button', { name: '刷新', exact: true }).click()
        await expect(
          page.locator('.document-meta').getByText('已就绪', { exact: true }),
        ).toBeVisible()
        await page.getByRole('tab', { name: '目录与小片' }).click()
        await page.getByRole('button', { name: '加载当前结构' }).click()
        await page.getByRole('button', { name: '按章节续读' }).first().click()
        await expect(page.locator('.el-dialog .source-text')).toContainText('晨星')
        await page.locator('.el-dialog__headerbtn').click()
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: '下载原文', exact: true }).click()
        const file = await download
        expect(file.suggestedFilename()).toBe('document-' + documentId + '.txt')
        return {
          status: content.document.ingestionStatus,
          revision: content.document.activeProcessingRevision,
          sections: sections.length,
          chunks: chunks.length,
          sectionComplete: section.complete,
        }
      },
      true,
    )

    await check('真实结构化 JSON 问答与引用', async () => {
      const result = aiSchema.parse(
        await (
          await api('/chat', 'POST', {
            question: '项目的编号是什么，备份在什么时候执行？请给出出处。',
            scope: scope(),
            modelProfile: 'knowledge',
            responseFormat: 'STRUCTURED',
          })
        ).json(),
      )
      report.jsonAnswer = {
        status: result.status,
        mock: result.mock,
        modelId: result.modelId,
        modelAttempts: result.modelAttempts,
        traceId: result.traceId,
        citationCount: result.citations.length,
        route: result.route,
      }
      traces.add(result.traceId)
      expect(result.mock).toBe(false)
      expect(result.modelAttempts).toBeGreaterThan(0)
      expect(result.status).toBe('SUCCESS')
      expect(result.answer).toContain('NVD-7319')
      expect(result.citations.length).toBeGreaterThan(0)
      expect(result.citations.every((citation) => citation.document.id === documentId)).toBe(true)
      expect(result.route?.profile).toBe('knowledge')
      return report.jsonAnswer
    })

    await check('本人会话创建、只读工具 SSE 与版本历史', async () => {
      await page.getByRole('link', { name: '知识问答', exact: true }).click()
      await applyScope()
      await page.getByLabel('新会话标题').fill(title)
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/sessions') && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: '新建会话', exact: true }).click()
      expect((await created).status()).toBe(201)
      await expect(page.locator('.session-panel')).toContainText(/会话 #\d+ · 版本/)
      const sessionId = Number(
        (await page.locator('.session-panel').textContent())!.match(/会话 #(\d+) · 版本/)![1],
      )
      const session = sessionSchema.parse(await (await api('/sessions/' + sessionId)).json())
      sessions.push(session.id)
      report.sessionId = session.id
      await page.getByRole('button', { name: '会话设置', exact: true }).click()
      await page.getByLabel('模型配置', { exact: true }).selectOption('knowledge')
      await page.getByLabel('工具续轮', { exact: true }).selectOption('READ_ONLY')
      await page.getByRole('button', { name: '查看可用工具', exact: true }).click()
      await page.getByRole('button', { name: '完成设置', exact: true }).click()
      const definitions = z
        .array(toolSchema)
        .parse(await (await api('/tools?taskType=KNOWLEDGE_QA')).json())
      expect(definitions.some((tool) => tool.name === 'search_knowledge' && tool.enabled)).toBe(
        true,
      )
      await page
        .getByLabel('你的问题')
        .fill('请使用只读工具核对当前资料：项目代号和编号是什么，备份何时执行？请引用资料。')
      const pending = page.waitForResponse(
        (response) =>
          response.url().endsWith('/chat/stream') && response.request().method() === 'POST',
        { timeout: 90_000 },
      )
      await page.getByRole('button', { name: '发送问题' }).click()
      const response = await pending
      report.sseStatus = response.status()
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('text/event-stream')
      await expect(page.getByRole('button', { name: '停止阅读', exact: true })).toHaveCount(0, {
        timeout: 90_000,
      })
      await expect(page.getByText('完整交付', { exact: true })).toBeVisible()
      await expect(page.locator('.chat-exchange .markdown')).toContainText('NVD-7319')
      await expect(page.locator('.chat-exchange .citations button').first()).toBeVisible()
      await expect(page.locator('.answer-footer')).not.toContainText('测试结果')
      const current = sessionSchema.parse(await (await api('/sessions/' + session.id)).json())
      const history = z
        .array(sessionMessageSchema)
        .parse(await (await api(`/sessions/${session.id}/messages?afterSeq=0&size=100`)).json())
      expect(current.version).toBeGreaterThan(session.version)
      expect(
        history.some((event) => event.role === 'ASSISTANT' && event.content?.includes('NVD-7319')),
      ).toBe(true)
      const toolRequests = history.filter((event) => event.role === 'TOOL_REQUEST')
      const toolResults = history.filter((event) => event.role === 'TOOL_RESULT')
      expect(toolRequests.length).toBeGreaterThan(0)
      for (const event of toolRequests)
        expect(
          toolResults.filter(
            (result) =>
              result.toolCallId === event.toolCallId && result.toolName === event.toolName,
          ),
        ).toHaveLength(1)
      const traceLink = page.locator('.answer-footer a').first()
      const traceId = decodeURIComponent((await traceLink.getAttribute('href'))!.split('/').pop()!)
      traces.add(traceId)
      report.sse = {
        sessionId: session.id,
        version: current.version,
        historyEvents: history.length,
        toolRequests: toolRequests.length,
        traceId,
      }
      return report.sse
    })

    if (sessions.length)
      await check('会话版本冲突、范围继承与真实多轮 JSON', async () => {
        const id = sessions[0]!
        const current = sessionSchema.parse(await (await api('/sessions/' + id)).json())
        const conflict = await api(
          '/chat',
          'POST',
          { question: '旧版本应拒绝且不调用模型', sessionId: id, sessionVersion: 1 },
          409,
        )
        expect((await conflict.json()).code).toBe('SESSION_CONFLICT')
        const result = aiSchema.parse(
          await (
            await api('/chat', 'POST', {
              question: '刚才那个项目恢复后需要核对哪两项？请引用来源。',
              sessionId: id,
              sessionVersion: current.version,
              modelProfile: 'knowledge',
              responseFormat: 'TEXT',
            })
          ).json(),
        )
        expect(result.status).toBe('SUCCESS')
        expect(result.mock).toBe(false)
        expect(result.citations.length).toBeGreaterThan(0)
        expect(result.sessionId).toBe(id)
        expect(result.sessionVersion).toBeGreaterThan(current.version)
        expect(result.answer).toContain('校验和')
        answer = result
        traces.add(result.traceId)
        report.followup = {
          status: result.status,
          version: result.sessionVersion,
          mock: result.mock,
          traceId: result.traceId,
          modelAttempts: result.modelAttempts,
          citationCount: result.citations.length,
        }
        return report.followup
      })

    if (answer)
      await check('模型回答笔记的完整预览、批准与新文档', async () => {
        const sources = [
          ...new Map(
            answer!.citations.map(({ document }) => [
              document.id + ':' + document.documentVersion,
              {
                knowledgeBaseId: document.knowledgeBaseId,
                documentId: document.id,
                documentVersion: document.documentVersion,
              },
            ]),
          ).values(),
        ]
        const prepared = approvalSchema.parse(
          await (
            await api('/notes/prepare', 'POST', {
              knowledgeBaseId: baseId,
              title: title + '-回答笔记',
              content: answer!.answer,
              sourceDependencies: sources,
            })
          ).json(),
        )
        report.approvalId = prepared.approvalId
        approvals.push(prepared.approvalId)
        expect(prepared.status).toBe('WAITING')
        expect(prepared.documentId).toBeNull()
        // Enter the actual approval flow through the answer's save action.
        await page.getByRole('button', { name: '准备保存笔记', exact: false }).click()
        await page.locator('.el-dialog .el-select__wrapper').click()
        await page.getByRole('option', { name: title + ' · #' + baseId, exact: true }).click()
        const created = page.waitForResponse(
          (response) =>
            response.url().endsWith('/notes/prepare') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '准备并预览确认', exact: false }).click()
        expect((await created).status()).toBe(200)
        await expect(page).toHaveURL(/\/approvals\/[^/]+$/)
        const uiApproval = approvalSchema.parse(
          await (
            await api(
              '/approvals/' + decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!),
            )
          ).json(),
        )
        approvals.push(uiApproval.approvalId)
        await expect(page).toHaveURL(new RegExp('/approvals/' + uiApproval.approvalId + '$'))
        await expect(page.getByRole('heading', { name: '全部来源依赖', exact: true })).toBeVisible()
        await page.getByRole('button', { name: '已核对，批准保存', exact: true }).click()
        await expect(page.getByText('笔记已保存为文档', { exact: false })).toBeVisible()
        const decided = approvalSchema.parse(
          await (await api('/approvals/' + uiApproval.approvalId)).json(),
        )
        expect(decided.status).toBe('APPROVED')
        expect(decided.documentId).not.toBeNull()
        const saved = contentSchema.parse(
          await (await api('/documents/' + decided.documentId)).json(),
        )
        expect(saved.sourceDependencies.some((source) => source.documentId === documentId)).toBe(
          true,
        )
        await api('/approvals/' + prepared.approvalId + '/decision', 'POST', { approved: false })
        report.note = {
          approvalId: decided.approvalId,
          status: decided.status,
          documentId: decided.documentId,
          sourceCount: saved.sourceDependencies.length,
        }
        return report.note
      })

    for (const strategy of ['FIXED', 'PLANNED'] as const)
      await check('真实报告生成与产物：' + strategy, async () => {
        await page.getByRole('link', { name: '报告任务', exact: true }).click()
        await applyScope()
        await page
          .getByText(strategy === 'FIXED' ? '常见问题 FAQ' : '研究报告', { exact: true })
          .click()
        if (strategy === 'PLANNED') await page.getByText('受限研究计划', { exact: true }).click()
        await page
          .getByLabel('主题', { exact: true })
          .fill('请用中文归纳晨星项目的编号、备份时间与恢复检查项，严格依据所选资料。')
        await page
          .locator('.document-choice')
          .filter({ hasText: marker + '.md' })
          .locator('.el-checkbox')
          .click()
        const pending = page.waitForResponse(
          (response) => response.url().endsWith('/tasks') && response.request().method() === 'POST',
        )
        await page.getByRole('button', { name: '创建报告任务', exact: false }).click()
        const response = await pending
        expect(response.status()).toBe(202)
        await expect(page).toHaveURL(/\/tasks\/\d+$/)
        const createdId = Number(new URL(page.url()).pathname.split('/').pop())
        const created = taskSchema.parse(await (await api('/tasks/' + createdId)).json())
        tasks.push(created.taskId)
        const finished = await taskFinished(created.taskId)
        expect(['SUCCEEDED', 'PARTIAL']).toContain(finished.status)
        expect(finished.modelAttempts).toBeGreaterThan(0)
        expect(finished.progress?.percent).toBe(100)
        expect(finished.progress?.completedSteps).toBe(5)
        expect(finished.artifactId).not.toBeNull()
        expect(finished.coverage?.length).toBeGreaterThan(0)
        await page.getByRole('button', { name: '刷新状态', exact: true }).click()
        await expect(page.locator('.task-facts')).toContainText('/ 5')
        await page.getByRole('button', { name: '查询计划', exact: true }).click()
        const planResponse = await api(
          '/tasks/' + created.taskId + '/plan',
          'GET',
          undefined,
          strategy === 'PLANNED' ? 200 : 204,
        )
        if (strategy === 'PLANNED') {
          const value = planSchema.parse(await planResponse.json())
          expect(value.plan.steps).toHaveLength(3)
          report.plan = {
            planHash: value.planHash,
            modelId: value.modelId,
            steps: value.plan.steps,
          }
          await expect(page.getByText('ResearchWorker', { exact: false })).toBeVisible()
        }
        await page.getByRole('button', { name: '核验并预览报告', exact: true }).click()
        await expect(page.locator('.markdown')).toContainText('NVD-7319', { timeout: 30_000 })
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: '下载 Markdown', exact: true }).click()
        expect((await download).suggestedFilename()).toBe('report-' + created.taskId + '.md')
        const artifact = await api('/artifacts/' + finished.artifactId)
        expect(artifact.headers()['content-type']).toContain('text/markdown')
        expect(await artifact.text()).toContain('NVD-7319')
        const runsResponse = await api('/runs?page=0&size=100')
        const runList = (await runsResponse.json()) as Array<{
          traceId: string
          taskId: number | null
        }>
        for (const run of runList.filter((run) => run.taskId === created.taskId))
          traces.add(run.traceId)
        return {
          taskId: finished.taskId,
          strategy,
          status: finished.status,
          attempts: finished.modelAttempts,
          artifactId: finished.artifactId,
          coverage: finished.coverage,
        }
      })

    await check('本人持久运行图、真实模型叶节点与浏览器图展示', async () => {
      expect(traces.size).toBeGreaterThan(0)
      const expires = Date.now() + 30_000
      const summaries: unknown[] = []
      for (const id of traces) {
        let graph = graphSchema.parse(
          await (await api('/runs/' + encodeURIComponent(id) + '/graph')).json(),
        )
        while (!graph.nodes.length && Date.now() < expires) {
          await new Promise((resolve) => setTimeout(resolve, 2000))
          graph = graphSchema.parse(
            await (await api('/runs/' + encodeURIComponent(id) + '/graph')).json(),
          )
        }
        expect(graph.run.mock).toBe(false)
        expect(graph.nodes.length).toBeGreaterThan(0)
        expect(graph.nodes.some((node) => node.type === 'MODEL')).toBe(true)
        expect(graph.costStatus).toBe('UNKNOWN')
        summaries.push({
          traceId: id,
          taskId: graph.run.taskId,
          status: graph.run.status,
          incomplete: graph.incomplete,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          missingNodeIds: graph.missingNodeIds,
          usage: graph.nodes
            .filter((node) => ['MODEL', 'EMBEDDING'].includes(node.type))
            .map((node) => ({
              type: node.type,
              modelId: node.modelId,
              status: node.status,
              inputTokens: node.inputTokens,
              outputTokens: node.outputTokens,
              usageSource: node.usageSource,
            })),
        })
      }
      report.graphs = summaries
      await page.getByRole('link', { name: '运行检查', exact: true }).click()
      const id = [...traces].at(-1)!
      await page.getByRole('link', { name: id, exact: true }).click()
      await expect(page.getByRole('heading', { name: '实际调用与依赖', exact: true })).toBeVisible()
      await expect(page.locator('.run-graph g').first()).toBeVisible()
      await expect(page.getByRole('heading', { name: '实际时间线', exact: true })).toBeVisible()
      expect(pageErrors).toEqual([])
      return summaries
    })

    await check('来源撤销后的会话占位与报告拒绝下载', async () => {
      await openBase()
      await page.getByRole('button', { name: '禁用知识库', exact: true }).click()
      await page.getByRole('button', { name: '确定', exact: true }).click()
      await expect(page.getByRole('button', { name: '重新启用', exact: true })).toBeVisible()
      await api('/documents/' + documentId, 'GET', undefined, 403)
      for (const id of sessions) {
        const rows = z
          .array(sessionMessageSchema)
          .parse(await (await api(`/sessions/${id}/messages?afterSeq=0&size=100`)).json())
        expect(rows.some((row) => row.status === 'RESTRICTED')).toBe(true)
        for (const row of rows.filter((row) => row.status === 'RESTRICTED')) {
          expect(row.content).toBeNull()
          expect(row.sourceReferences).toEqual([])
        }
      }
      for (const id of tasks) {
        const task: TaskSnapshot = taskSchema.parse(await (await api('/tasks/' + id)).json())
        if (task.artifactId) await api('/artifacts/' + task.artifactId, 'GET', undefined, 403)
      }
      await page.getByRole('button', { name: '重新启用', exact: true }).click()
      await expect(page.getByRole('button', { name: '禁用知识库', exact: true })).toBeVisible()
      return { restrictedHistory: true, revokedArtifact: true }
    })
  } finally {
    for (const id of approvals) {
      try {
        const value = approvalSchema.parse(
          await (await api('/approvals/' + encodeURIComponent(id))).json(),
        )
        if (value.status === 'WAITING')
          await api('/approvals/' + encodeURIComponent(id) + '/decision', 'POST', {
            approved: false,
          })
        cleanup.push({ resource: 'approval', id, status: 'APPROVED 或 REJECTED；无删除接口' })
      } catch {
        cleanup.push({ resource: 'approval', id, status: '清理未确认' })
      }
    }
    for (const id of tasks) {
      try {
        const value = taskSchema.parse(await (await api('/tasks/' + id)).json())
        if (['QUEUED', 'RUNNING', 'PAUSED'].includes(value.status))
          await api('/tasks/' + id + '/actions', 'POST', { action: 'cancel' })
        cleanup.push({ resource: 'task', id, status: '终态或已取消；无删除接口' })
      } catch {
        cleanup.push({ resource: 'task', id, status: '清理未确认' })
      }
    }
    for (const id of sessions) {
      try {
        const value = sessionSchema.parse(await (await api('/sessions/' + id)).json())
        await api('/sessions/' + id + '?version=' + value.version, 'DELETE', undefined, 204)
        cleanup.push({ resource: 'session', id, status: 'DELETED' })
      } catch {
        cleanup.push({ resource: 'session', id, status: '清理未确认' })
      }
    }
    if (baseId) {
      try {
        const value = baseSchema.parse(await (await api('/knowledge-bases/' + baseId)).json())
        await api('/knowledge-bases/' + baseId + '?version=' + value.version, 'DELETE')
        cleanup.push({ resource: 'base-and-documents', id: baseId, status: '逻辑删除' })
      } catch {
        cleanup.push({ resource: 'base-and-documents', id: baseId, status: '清理未确认' })
      }
    }
    if (token) {
      try {
        await api('/auth/logout', 'POST')
        cleanup.push({ resource: 'token', status: 'REVOKED' })
      } catch {
        cleanup.push({ resource: 'token', status: '撤销未确认' })
      }
    }
    report.cleanup = cleanup
    report.finishedAt = new Date().toISOString()
    report.pageErrors = pageErrors
    await save()
  }
  expect(
    checks.filter((check) => check.status === 'FAIL'),
    '真实联调失败项，详见脱敏证据',
  ).toEqual([])
  expect(cleanup.some((entry) => entry.status.includes('未确认'))).toBe(false)
})
