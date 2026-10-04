import { test, expect } from '@playwright/test'
import { mockBackend, login } from './mockBackend'
import { session, modernTask, plan, graph, ingestion, sectionPage } from '../stageFixtures'
import { ai } from '../fixtures'
test('受控接口：凭证失败、登录、刷新清除内存身份', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await mockBackend(page)
  await page.goto('/login')
  await page.screenshot({ path: 'var/screenshots/login.png', fullPage: true })
  await page.getByLabel('用户名', { exact: true }).fill('learner')
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录工作台' }).click()
  await expect(page.getByText('用户名或密码错误', { exact: false })).toBeVisible()
  await page.getByLabel('密码', { exact: true }).fill('test-password-123')
  await page.getByRole('button', { name: '登录工作台' }).click()
  await expect(page.getByRole('heading', { name: '带着问题，走进知识。' })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/chat-desktop.png', fullPage: true })
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('token')
  await page.reload()
  await expect(page).toHaveURL(/\/login/)
  expect(errors).toEqual([])
})
test('受控接口：首次改密，原密码 401 保持身份，成功后重新登录', async ({ page }) => {
  const state = await mockBackend(page, { mustChange: true })
  await login(page)
  await expect(page).toHaveURL(/\/change-password/)
  await page.getByLabel('原密码 / 临时密码').fill('wrong-password')
  await page.getByLabel('新密码', { exact: true }).fill('new-password-123')
  await page.getByLabel('确认新密码').fill('new-password-123')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page.getByText('原密码不正确', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/change-password/)
  expect(state.requests.filter((r) => r === 'GET /auth/me').length).toBeGreaterThan(1)
  await page.getByLabel('原密码 / 临时密码').fill('test-password-123')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page).toHaveURL(/\/login/)
})
test('受控接口：完整 SSE、旧证据复核与笔记批准闭环', async ({ page }) => {
  const state = await mockBackend(page, { oldEvidence: true })
  await login(page)
  await page.getByRole('textbox', { name: '你的问题' }).fill('怎样验证契约？')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByText('完整交付', { exact: true })).toBeVisible()
  await expect(page.locator('.markdown')).toContainText('先验证契约')
  await expect(page.locator('.markdown')).not.toContainText('暂时分段')
  await page.getByRole('button', { name: /E1.*验证指南/ }).click()
  await expect(page.getByText('当前原文已更新', { exact: false })).toBeVisible()
  await expect(page.locator('.el-drawer .source-text')).toHaveText('知识与验证')
  await page.locator('.el-drawer__close-btn').click()
  await page.getByRole('button', { name: '准备保存笔记' }).click()
  await page.getByText('选择本人启用的知识库', { exact: true }).click()
  await page.getByRole('option', { name: '学习资料 · #12' }).click()
  await page.getByRole('button', { name: '准备并预览确认' }).click()
  await expect(page).toHaveURL(/\/approvals\/approval-1/)
  await expect(page.getByRole('heading', { name: '全部来源依赖' })).toBeVisible()
  await page.getByRole('button', { name: '已核对，批准保存' }).click()
  await expect(page.getByText('笔记已保存为文档', { exact: false })).toBeVisible()
  expect(state.approval.documentId).toBe(102)
  await page.getByRole('link', { name: '打开文档 #102' }).click()
  await expect(page).toHaveURL(/\/documents\/102/)
})
test('受控接口：文档空中间页允许下一页；禁用库按已知 ID 恢复', async ({ page }) => {
  const state = await mockBackend(page, { documentEmptyPage: true })
  await login(page)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await page.getByRole('link', { name: /学习资料/ }).click()
  await expect(page.locator('.el-table__empty-text')).toBeVisible()
  await page.getByRole('button', { name: '下一页' }).click()
  await expect(page.getByRole('link', { name: '验证指南' })).toBeVisible()
  expect(state.requests.some((r) => r.includes('/documents?') && r.includes('page=1'))).toBe(true)
  await page.getByRole('button', { name: '禁用知识库', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByText('知识库已禁用', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await page.getByRole('link', { name: '本次禁用 #12' }).click()
  await page.getByRole('button', { name: '重新启用' }).click()
  await expect(page.getByRole('button', { name: '禁用知识库', exact: true })).toBeVisible()
})
test('受控接口：报告任务动作、PARTIAL 产物和来源撤销', async ({ page }) => {
  const state = await mockBackend(page)
  state.document.ingestionStatus = 'RECEIVED'
  state.document.activeProcessingRevision = null
  await login(page)
  await page.getByRole('link', { name: '报告任务', exact: true }).click()
  await page.getByLabel('主题', { exact: true }).fill('整理验证流程')
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建报告任务' }).click()
  await expect(page).toHaveURL(/\/tasks\/51/)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.getByText('正在生成', { exact: true })).toBeVisible()
  state.task.status = 'PARTIAL'
  state.task.artifactId = 83
  state.task.completedSteps = 3
  state.task.stateVersion++
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByText('部分覆盖', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '核验并预览报告' }).click()
  await expect(page.getByRole('heading', { name: '受控报告' })).toBeVisible()
  expect(state.requests).toContain('GET /artifacts/83')
  expect(state.requests).not.toContain('GET /artifacts/51')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 Markdown' }).click()
  expect((await downloaded).suggestedFilename()).toBe('report-51.md')
  state.reportDenied = true
  await page.getByRole('button', { name: '核验并预览报告' }).click()
  await expect(page.getByText('产物当前不可访问', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: '受控报告' })).toHaveCount(0)
})
test('受控接口：memory 版本 403 复核列表、不登出、不自动覆盖', async ({ page }) => {
  const state = await mockBackend(page)
  await login(page)
  await page.getByRole('link', { name: '个人偏好', exact: true }).click()
  await page.getByRole('button', { name: '更正', exact: true }).click()
  await page.locator('.el-dialog textarea').fill('保留我的草稿')
  await page.getByRole('button', { name: '保存更正' }).click()
  await expect(page.locator('.el-dialog')).toContainText('已重新读取本人列表')
  await expect(page.locator('.el-dialog textarea')).toHaveValue('保留我的草稿')
  await expect(page).toHaveURL(/\/memories/)
  expect(state.requests.filter((r) => r === 'PATCH /memories/1')).toHaveLength(1)
})
test('受控接口：ADMIN 跨库只读、临时密码一次性展示', async ({ page }) => {
  await mockBackend(page, { admin: true, readOnly: true })
  await login(page)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await page.getByRole('link', { name: /学习资料/ }).click()
  await expect(page.getByRole('button', { name: '编辑信息' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传资料' })).toHaveCount(0)
  await page.getByRole('link', { name: '用户管理', exact: true }).click()
  await page.getByRole('textbox', { name: '新用户用户名' }).fill('new-learner')
  await page.getByRole('button', { name: '创建用户' }).click()
  await expect(page.locator('.temporary-password')).toHaveText('mock-temporary-123')
  await page.getByRole('button', { name: '已记录，关闭' }).click()
  await expect(page.locator('.temporary-password')).not.toBeVisible()
})
test('受控接口：窄屏导航与问答；USER 隐藏管理员入口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockBackend(page)
  await login(page)
  await expect(page.getByRole('heading', { name: '带着问题，走进知识。' })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/chat-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.getByRole('link', { name: '用户管理', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '知识，妥善收纳。' })).toBeVisible()
})

test('受控接口：UTF-8 上传 202 与待处理状态', async ({ page }) => {
  const state = await mockBackend(page)
  await login(page)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await page.getByRole('link', { name: /学习资料/ }).click()
  await page.getByLabel('上传文档文件').setInputFiles({
    name: 'source.md',
    mimeType: '',
    buffer: Buffer.from('# 验证\nUTF-8 文本。', 'utf8'),
  })
  await page.getByRole('button', { name: '上传资料', exact: true }).click()
  await expect(page).toHaveURL(/\/documents\/101/)
  await expect(page.locator('.document-meta').getByText('待处理', { exact: true })).toBeVisible()
  await expect(page.getByText('等待后台处理', { exact: false })).toBeVisible()
  expect(state.requests).toContain('POST /documents')
})

test('新版会话：冲突后核对历史、新版本手动提问、受限内容清理与 204 删除', async ({ page }) => {
  await mockBackend(page)
  let current = { ...session },
    created = false,
    conflict = true,
    restricted = false
  const versions: number[] = []
  await page.route('**/api/v1/sessions**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method()
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (path.endsWith('/sessions') && method === 'GET') return send(created ? [current] : [])
    if (method === 'POST') {
      expect(request.headers()['idempotency-key']).toBeTruthy()
      expect(request.postDataJSON()).toEqual({ title: '备份规则' })
      created = true
      return send(current, 201)
    }
    if (path.endsWith('/messages'))
      return send(
        current.version === 1
          ? []
          : [
              {
                seq: 1,
                role: 'ASSISTANT',
                status: restricted ? 'RESTRICTED' : 'SUCCESS',
                content: restricted ? '不能展示的旧内容' : '已保存的回答',
                sourceDependencies: [],
                sourceReferences: [],
                toolCallId: null,
                toolName: null,
                createdAt: session.createdAt,
                scope: session.scope,
              },
            ],
      )
    if (method === 'DELETE') {
      expect(url.searchParams.get('version')).toBe(String(current.version))
      created = false
      return route.fulfill({ status: 204 })
    }
    return send(current)
  })
  await page.route('**/api/v1/chat/stream', async (route) => {
    const body = route.request().postDataJSON()
    expect(body.sessionId).toBe(701)
    versions.push(body.sessionVersion)
    current = { ...current, version: current.version + 1 }
    if (conflict) {
      conflict = false
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'SESSION_CONFLICT',
          message: '会话版本已变化',
          retryable: false,
        }),
      })
    }
    const frame = (event: string, data: unknown, id: number) =>
      `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        frame('progress', { stage: 'processing' }, 1) +
        frame('progress', { stage: 'validated' }, 2) +
        frame('done', { ...ai, sessionId: 701, sessionVersion: current.version }, 3),
    })
  })
  await login(page)
  await page.getByLabel('新会话标题').fill('备份规则')
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await expect(page.locator('.session-panel')).toContainText('会话 #701 · 版本 1')
  await page.getByLabel('你的问题').fill('继续解释')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.locator('.session-panel')).toContainText('版本 2')
  await expect(page.locator('.session-history')).toContainText('已保存的回答')
  await expect(page.getByLabel('你的问题')).toHaveValue('继续解释')
  expect(versions).toEqual([1])
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByText('完整交付', { exact: true })).toBeVisible()
  expect(versions).toEqual([1, 2])
  restricted = true
  await page.getByRole('button', { name: '核对服务端历史' }).click()
  await expect(page.locator('.session-history')).toContainText('历史内容当前不可访问')
  await expect(page.getByText('已保存的回答', { exact: true })).toHaveCount(0)
  await expect(page.getByText('不能展示的旧内容', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '删除会话', exact: true }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.session-history')).toHaveCount(0)
})

test('新版报告：五步进度、并行步骤、覆盖与受限计划', async ({ page }) => {
  const state = await mockBackend(page)
  state.task = { ...modernTask }
  await page.route('**/api/v1/tasks/51/plan', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) }),
  )
  await login(page)
  await page.getByRole('link', { name: '报告任务', exact: true }).click()
  await page.getByLabel('已知任务 ID').fill('51')
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('.task-facts')).toContainText('/ 5')
  await expect(page.locator('.active-step')).toHaveCount(2)
  await expect(page.getByText('覆盖未完成', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '查询计划' }).click()
  await expect(page.getByText('核对备份规则', { exact: true })).toBeVisible()
  await expect(page.getByText('依赖：research、analysis', { exact: false })).toBeVisible()
})

test('新版文档：原代次恢复与章节续读，版本冲突清除旧页', async ({ page }) => {
  const state = await mockBackend(page)
  state.document.ingestionStatus = 'FAILED'
  let recovered = false,
    cursor = false
  await page.route('**/api/v1/documents/101/ingestion', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ingestion),
    }),
  )
  await page.route('**/api/v1/documents/101/index-actions?**', async (route) => {
    expect(route.request().url()).toContain('action=recover&processingRevision=3')
    recovered = true
    await route.fulfill({ status: 200, body: '' })
  })
  await page.route('**/api/v1/documents/101/sections**', async (route) => {
    const url = new URL(route.request().url())
    const send = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (url.pathname.endsWith('/sections'))
      return send([
        {
          sectionId: 's1',
          parentSectionId: null,
          ancestorSectionIds: [],
          headingPath: '步骤',
          ordinal: 0,
          startOffset: 0,
          endOffset: 5,
        },
      ])
    expect(url.searchParams.get('documentVersion')).toBe('1')
    expect(url.searchParams.get('processingRevision')).toBe('1')
    if (url.searchParams.has('afterOffset')) {
      cursor = true
      return send(
        { code: 'CONTEXT_VERSION_CONFLICT', message: '代次已变化', retryable: false },
        409,
      )
    }
    return send(sectionPage)
  })
  await login(page)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await page.getByRole('link', { name: /学习资料/ }).click()
  await page.getByRole('link', { name: '验证指南', exact: true }).click()
  await page.getByRole('button', { name: '提前恢复原代次' }).click()
  await expect.poll(() => recovered).toBe(true)
  state.document.ingestionStatus = 'READY'
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('tab', { name: '目录与小片' }).click()
  await page.getByRole('button', { name: '加载当前结构' }).click()
  await page.getByRole('button', { name: '按章节续读' }).click()
  await expect(page.locator('.el-dialog .source-text')).toHaveText('知识与验证')
  await page.getByRole('button', { name: '下一页章节原文' }).click()
  await expect.poll(() => cursor).toBe(true)
  await expect(page.getByText('旧游标已清除', { exact: false })).toBeVisible()
  await expect(page.locator('.el-dialog .source-text')).not.toBeVisible()
  await page.route('**/api/v1/documents/101/source', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ACCESS_DENIED', message: '来源当前不可读', retryable: false }),
    }),
  )
  await page.getByRole('button', { name: '下载原文', exact: true }).click()
  await expect(page.getByText('来源当前不可读', { exact: false })).toBeVisible()
  await expect(page.locator('.document-meta')).toHaveCount(0)
  await expect(page.locator('.source-text')).toHaveCount(0)
})

test('新版运行：实际节点、依赖、未知费用与上一执行', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/runs?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([graph.run]),
    }),
  )
  await page.route('**/api/v1/runs/trace-1/graph', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...graph, incomplete: true, missingNodeIds: ['missing-span'] }),
    }),
  )
  await login(page)
  await page.getByRole('link', { name: '运行检查', exact: true }).click()
  await page.getByRole('link', { name: 'trace-1', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运行检查', exact: true })).toBeVisible()
  await expect(page.getByText('运行图不完整', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: '上一执行' })).toHaveAttribute(
    'href',
    '/runs/trace-old',
  )
  await page.getByRole('button', { name: '查看节点 模型调用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型调用', exact: true })).toBeVisible()
  await expect(page.getByText('已知提供方用量：输入 10 / 输出 5', { exact: false })).toBeVisible()
  await expect(page.getByText('费用状态 UNKNOWN', { exact: false })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/run-graph.png', fullPage: true })
})
