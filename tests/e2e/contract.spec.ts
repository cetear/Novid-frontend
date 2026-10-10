import { test, expect } from '@playwright/test'
import { mockBackend, login } from './mockBackend'
import { session, modernTask, graph, ingestion, sectionPage } from '../stageFixtures'
import { ai } from '../fixtures'
import { fee, mediaPreview, presentation, videoCapability } from '../mediaFixtures'
import { createHash } from 'node:crypto'
import { learningTask, quizResult, compilationResult, contentPlan } from '../learningFixtures'
test('资料内容计划：自动默认、204、动态数量与权限撤销清除', async ({ page }) => {
  const state = await mockBackend(page)
  state.task = { ...structuredClone(learningTask), status: 'PAUSED' }
  let phase: 'pending' | 'ready' | 'denied' = 'pending'
  await page.route('**/api/v1/tasks/51/content-plan', (route) =>
    route.fulfill({
      status: phase === 'pending' ? 204 : phase === 'denied' ? 403 : 200,
      contentType: 'application/json',
      body:
        phase === 'pending'
          ? undefined
          : JSON.stringify(
              phase === 'ready'
                ? contentPlan
                : { code: 'ACCESS_DENIED', message: '来源授权已撤销', retryable: false },
            ),
    }),
  )
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await expect(page.getByLabel('题目数量', { exact: true })).toHaveValue('0')
  await expect(page.getByLabel('主题', { exact: true })).toHaveCount(0)
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建学习任务', exact: false }).click()
  await expect(page.getByText('内容计划尚未生成或接受', { exact: false })).toBeVisible()
  phase = 'ready'
  await page.getByRole('button', { name: '查询计划' }).click()
  await expect(page.locator('.content-plan')).toContainText('已完成内容单元 1 / 1')
  await expect(page.locator('.content-plan')).toContainText('计划 1 题')
  await page.getByText('查看主题、内容单元与取舍', { exact: true }).click()
  await expect(page.locator('.content-plan')).toContainText('item-1')
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  phase = 'denied'
  await page.getByRole('button', { name: '查询计划' }).click()
  await expect(page.getByText('来源授权已撤销', { exact: false })).toBeVisible()
  await expect(page.locator('.content-plan')).toHaveCount(0)
  expect(state.requests).not.toContain('GET /tasks/51/plan')
})
test('学习创建：结果不确定时保留幂等键，选项变更使用新键', async ({ page }) => {
  await mockBackend(page)
  const submitted: Array<{ key: string; body: Record<string, unknown> }> = []
  await page.route('**/api/v1/tasks', (route) => {
    submitted.push({
      key: route.request().headers()['idempotency-key']!,
      body: route.request().postDataJSON(),
    })
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'TEMPORARILY_UNAVAILABLE',
        message: '登记结果待核对',
        retryable: true,
      }),
    })
  })
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByLabel('备注（可选）', { exact: true }).fill('稳定创建')
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建学习任务', exact: false }).click()
  await expect(page.getByRole('button', { name: '使用原幂等键重新确认' })).toBeVisible()
  expect(submitted).toHaveLength(1)
  await page.getByRole('button', { name: '使用原幂等键重新确认' }).click()
  await expect.poll(() => submitted.length).toBe(2)
  expect(submitted[1]).toEqual(submitted[0])
  await page.getByLabel('题目数量', { exact: true }).fill('2')
  await page.getByLabel('题目数量', { exact: true }).blur()
  await page.getByRole('button', { name: '创建学习任务', exact: false }).click()
  await expect.poll(() => submitted.length).toBe(3)
  expect(submitted[2]!.key).not.toBe(submitted[0]!.key)
  expect(submitted[2]!.body).toMatchObject({ quizOptions: { questionCount: 2 } })
})
test('学习自测：六阶段、暂停恢复、答案折叠、绝对引用定位和来源撤销', async ({ page }) => {
  const state = await mockBackend(page)
  state.task = structuredClone(learningTask)
  let denied = false
  await page.route('**/api/v1/tasks/51/result', (route) =>
    route.fulfill({
      status: denied ? 403 : 200,
      contentType: 'application/json',
      headers: { 'X-Request-Id': 'learning-result-uuid' },
      body: JSON.stringify(
        denied
          ? { code: 'ACCESS_DENIED', message: '学习来源已撤销', retryable: false }
          : quizResult,
      ),
    }),
  )
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await expect(page.getByText('常见问题 FAQ', { exact: true })).toHaveCount(0)
  await page.getByLabel('备注（可选）', { exact: true }).fill('自测验证知识')
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建学习任务', exact: false }).click()
  await expect(page).toHaveURL(/\/tasks\/51/)
  await expect(page.locator('.task-facts')).toContainText('/ 6')
  await expect(page.locator('.el-progress__text')).toContainText('90%')
  await expect(page.locator('.active-step')).toHaveCount(1)
  expect(state.bodies).toContainEqual(
    expect.objectContaining({
      taskType: 'QUIZ_GENERATION',
      strategy: 'FIXED',
      quizOptions: {
        questionCount: 0,
        questionTypes: ['SINGLE_CHOICE', 'SHORT_ANSWER'],
        difficulty: 'MEDIUM',
      },
    }),
  )
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await expect(page.getByText('已暂停', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(
    page.locator('.panel > .section-title').getByText('正在生成', { exact: true }),
  ).toBeVisible()
  state.task.status = 'SUCCEEDED'
  state.task.artifactId = 83
  state.task.completedSteps = 6
  state.task.progress = {
    ...state.task.progress!,
    completedSteps: 6,
    percent: 100,
    stage: 'PUBLISHING',
    message: '学习结果已发布',
    executionActive: false,
    currentSteps: [],
    pollAfterMillis: 0,
    steps: state.task.progress!.steps.map((step) => ({ ...step, status: 'SUCCEEDED' })),
  }
  state.task.stateVersion++
  await page.getByRole('button', { name: '刷新状态' }).click()
  await page.getByRole('button', { name: '核验并查看学习结果' }).click()
  await expect(page.locator('.learning-result')).toContainText('内容质量仍待人工判断')
  await expect(page.locator('.learning-question .markdown')).not.toBeVisible()
  await page.getByText('查看答案与解析', { exact: true }).click()
  await expect(page.locator('.learning-question .markdown')).toContainText('需要知识与验证')
  await page.getByRole('button', { name: '引用 · 验证指南', exact: true }).click()
  await expect(page.locator('.el-drawer .source-text')).toHaveText('与验证')
  await expect(page.getByRole('dialog', { name: '学习引用与原文' })).toContainText('[2, 5)')
  await page.getByRole('button', { name: '关闭此对话框', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '学习引用与原文' })).not.toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'var/screenshots/learning-quiz-mobile.png', fullPage: true })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载 Markdown' }).click()
  expect((await download).suggestedFilename()).toBe('report-51.md')
  denied = true
  await page.getByRole('button', { name: '核验并查看学习结果' }).click()
  await expect(page.getByText('学习来源已撤销', { exact: false })).toBeVisible()
  await expect(page.getByText('请求编号 learning-result-uuid', { exact: false })).toBeVisible()
  await expect(page.locator('.learning-result')).toHaveCount(0)
  await expect(page.locator('.markdown')).toHaveCount(0)
  denied = false
  await page.getByRole('button', { name: '核验并查看学习结果' }).click()
  state.document.documentVersion++
  await page.getByRole('button', { name: '引用 · 验证指南', exact: true }).click()
  await expect(page.getByText('来源版本或处理代次已变化', { exact: false })).toBeVisible()
  await expect(page.locator('.learning-result')).toHaveCount(0)
  await expect(page.locator('.el-drawer .source-text')).toHaveCount(0)
  expect(state.requests.filter((r) => r === 'POST /tasks')).toHaveLength(1)
})

test('资料整编：完整选项、目录分组与正文引用，未发布错误不重复创建', async ({ page }) => {
  const state = await mockBackend(page)
  state.task = { ...structuredClone(learningTask), status: 'SUCCEEDED', artifactId: 83 }
  state.task.completedSteps = 6
  state.task.progress = {
    ...state.task.progress!,
    completedSteps: 6,
    percent: 100,
    stage: 'PUBLISHING',
    message: '学习结果已发布',
    executionActive: false,
    currentSteps: [],
    pollAfterMillis: 0,
    steps: state.task.progress!.steps.map((step) => ({ ...step, status: 'SUCCEEDED' })),
  }
  let unavailable = true
  await page.route('**/api/v1/tasks/51/result', (route) =>
    route.fulfill({
      status: unavailable ? 409 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        unavailable
          ? { code: 'WORKFLOW_RESULT_UNAVAILABLE', message: '结果尚未发布', retryable: false }
          : compilationResult,
      ),
    }),
  )
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByText('资料整编', { exact: true }).click()
  await page.getByLabel('备注（可选）', { exact: true }).fill('整编复习资料')
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建学习任务', exact: false }).click()
  await page.getByRole('button', { name: '核验并查看学习结果' }).click()
  await expect(page.getByText('WORKFLOW_RESULT_UNAVAILABLE', { exact: false })).toBeVisible()
  expect(state.bodies).toContainEqual(
    expect.objectContaining({
      taskType: 'KNOWLEDGE_COMPILATION',
      compilationOptions: { detailLevel: 'DETAILED', maximumChapters: 0 },
    }),
  )
  unavailable = false
  await page.getByRole('button', { name: '核验并查看学习结果' }).click()
  await expect(page.getByRole('navigation', { name: '整编目录' })).toContainText('先核对再执行')
  await expect(page.locator('.learning-section h4')).toHaveText('验证依据')
  await expect(page.locator('.learning-section .markdown')).toContainText('依据资料进行验证')
  await expect(page.getByRole('heading', { name: '本人质量验收' })).toHaveCount(0)
  await page.screenshot({
    path: 'var/screenshots/learning-compilation-desktop.png',
    fullPage: true,
  })
  expect(state.requests.filter((r) => r === 'POST /tasks')).toHaveLength(1)
  expect(state.requests).not.toContain('GET /tasks/51/plan')
})
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
  await expect(page.getByRole('heading', { name: '单轮问答', level: 1, exact: true })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/chat-desktop.png', fullPage: true })
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('token')
  await page.reload()
  await expect(page).toHaveURL(/\/login/)
  expect(errors).toEqual([])
})

test('会话工作区：左侧切换、底部输入、右上参数与移动抽屉', async ({ page }) => {
  await mockBackend(page)
  let current = { ...session }
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/v1/sessions**', (route) => {
    const path = new URL(route.request().url()).pathname
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        path.endsWith('/sessions') ? [current] : path.endsWith('/messages') ? [] : current,
      ),
    })
  })
  await page.route('**/api/v1/chat/stream', (route) => {
    requests.push(route.request().postDataJSON())
    current = { ...current, version: current.version + 1 }
    return route.fulfill({
      contentType: 'text/event-stream',
      body: `id: 1\nevent: progress\ndata: {"stage":"processing"}\n\nid: 2\nevent: done\ndata: ${JSON.stringify({ ...ai, sessionId: session.id, sessionVersion: current.version })}\n\n`,
    })
  })
  await login(page)
  await expect(page.locator('.conversation-sidebar')).toBeVisible()
  await page.locator('.session-links .conversation-item').click()
  await expect(page.locator('.conversation-heading h1')).toHaveText(session.title)
  const list = await page.locator('.conversation-sidebar').boundingBox()
  const pane = await page.locator('.conversation-pane').boundingBox()
  const composer = await page.locator('.chat-composer').boundingBox()
  expect(list!.x + list!.width).toBeLessThanOrEqual(pane!.x + 1)
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await page.getByRole('button', { name: '会话设置', exact: true }).click()
  await page.getByLabel('模型配置', { exact: true }).selectOption('analysis')
  await page.getByLabel('回答格式', { exact: true }).selectOption('STRUCTURED')
  await page.getByLabel('工具续轮', { exact: true }).selectOption('READ_ONLY')
  await expect(page.getByLabel('回答格式', { exact: true })).toHaveValue('TEXT')
  await expect(page.getByLabel('回答格式', { exact: true })).toBeDisabled()
  await expect(page.locator('.conversation-settings-drawer')).toHaveCSS('transform', 'none')
  await page.screenshot({ path: 'var/screenshots/chat-settings.png' })
  await page.getByRole('button', { name: '完成设置', exact: true }).click()
  await page.getByLabel('你的问题').fill('继续研究')
  await page.getByRole('button', { name: '发送问题' }).click()
  await expect(page.getByText('完整交付', { exact: true })).toBeVisible()
  expect(requests).toEqual([
    expect.objectContaining({
      modelProfile: 'analysis',
      responseFormat: 'TEXT',
      toolMode: 'READ_ONLY',
      sessionId: session.id,
      sessionVersion: 1,
    }),
  ])
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.locator('.conversation-sidebar')).toHaveCount(0)
  await page.getByRole('button', { name: '打开会话列表' }).click()
  await expect(page.getByRole('navigation', { name: '会话列表', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.conversation-list-drawer')).not.toBeVisible()
  await page.getByRole('button', { name: '打开会话列表' }).click()
  await page.getByRole('button', { name: '单轮问答', exact: false }).click()
  await expect(page.locator('.conversation-heading h1')).toHaveText('单轮问答')
  await expect(page.locator('.conversation-list-drawer')).not.toBeVisible()
  await page.getByRole('button', { name: '会话设置', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.conversation-settings-drawer')).not.toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('费用账本：精确小计、未知费用提示与独立查询', async ({ page }) => {
  await mockBackend(page)
  await page.route('**/api/v1/tasks/51/fees', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(fee) }),
  )
  await login(page)
  await page.getByRole('link', { name: '费用记录', exact: true }).click()
  await page.getByLabel('费用资源标识').fill('51')
  await page.getByRole('button', { name: '查询费用', exact: true }).click()
  await expect(page.locator('.fee-panel')).toContainText('0.12500001')
  await expect(page.locator('.fee-panel')).toContainText('不能视为零费用')
  await expect(page).toHaveURL(/kind=tasks&id=51/)
  await page.screenshot({ path: 'var/screenshots/fees-desktop.png', fullPage: true })
})

test('媒体预览：审批与本人验收分开、PNG Bearer读取、编辑撤下旧附件', async ({ page }) => {
  const state = await mockBackend(page)
  const snapshot = {
    ...modernTask,
    taskType: 'NOTES_PPT',
    status: 'WAITING_APPROVAL',
    artifactId: null,
  }
  let preview = structuredClone(mediaPreview),
    bundle: typeof presentation | null = null,
    denied = false
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOukAAAAASUVORK5CYII=',
    'base64',
  )
  const checksum = createHash('sha256').update(png).digest('hex')
  const decisions: unknown[] = [],
    reviews: unknown[] = []
  await page.route('**/api/v1/tasks/51**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const send = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path.endsWith('/fees')) return send(fee)
    if (path.endsWith('/preview')) {
      if (route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON().previewVersion).toBe(preview.previewVersion)
        preview = {
          ...preview,
          previewVersion: preview.previewVersion + 1,
          estimatedAmount: null,
          units: route.request().postDataJSON().units,
        }
        snapshot.stateVersion++
        snapshot.status = 'WAITING_APPROVAL'
        bundle = null
      }
      return send(preview)
    }
    if (path.endsWith('/presentation-check'))
      return bundle ? send(bundle) : route.fulfill({ status: 204 })
    if (path.endsWith('/media-operations') || path.endsWith('/media-plans')) return send([])
    if (path.endsWith('/media-review')) {
      reviews.push(route.request().postDataJSON())
      snapshot.status = 'SUCCEEDED'
      snapshot.stateVersion++
      return route.fulfill({ status: 204 })
    }
    return send(snapshot)
  })
  await page.route('**/api/v1/media/approvals/*/decision', (route) => {
    decisions.push(route.request().postDataJSON())
    snapshot.status = 'WAITING_MEDIA_REVIEW'
    snapshot.stateVersion++
    bundle = structuredClone(presentation)
    bundle.pages[0]!.preview.checksum = checksum
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(preview) })
  })
  await page.route('**/api/v1/artifacts/92', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer mock-opaque-token')
    expect(route.request().url()).not.toContain('token')
    return denied
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'ACCESS_DENIED',
            message: '产物当前不可访问',
            retryable: false,
          }),
        })
      : route.fulfill({
          contentType: 'image/png',
          headers: { 'x-artifact-checksum': checksum },
          body: png,
        })
  })
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByLabel('已知任务 ID').fill('51')
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('.media-workbench')).toContainText('内容 1 页 + 来源 2 页 = 总计 3 页')
  await expect(page.getByRole('heading', { name: '理解水循环' })).toBeVisible()
  expect(decisions).toHaveLength(0)
  await page.getByRole('button', { name: '批准当前版本与费用' }).click()
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本人质量验收' })).toBeVisible()
  expect(decisions).toEqual([{ approved: true, taskId: 51 }])
  expect(reviews).toHaveLength(0)
  await page.getByRole('button', { name: '核验第 1 页' }).click()
  await expect(page.locator('.page-preview img')).toBeVisible()
  await expect(page.locator('.page-preview img')).toHaveAttribute('src', /^blob:/)
  await page.screenshot({ path: 'var/screenshots/presentation-desktop.png', fullPage: true })
  await page.getByText('媒体操作与实际计划', { exact: true }).click()
  await page.getByRole('button', { name: '读取实际计划' }).click()
  await expect(page.getByText('新 PPT 任务返回空列表属于正常情况', { exact: false })).toBeVisible()
  await page.getByLabel('本人验收说明').fill('已检查逐页图文与引用来源')
  await page.getByRole('button', { name: '已检查，接受产物' }).click()
  await expect(page.getByRole('button', { name: '下载正式 PPTX' })).toBeVisible()
  expect(reviews).toEqual([{ previewVersion: 1, accepted: true, note: '已检查逐页图文与引用来源' }])
  await page.getByRole('button', { name: '编辑内容并重新审批' }).click()
  await page.getByRole('dialog').getByRole('textbox').nth(1).fill('修改后的凝结解释')
  await page.getByRole('button', { name: '保存新版预览' }).click()
  await expect(page.locator('.page-preview img')).toHaveCount(0)
  await expect(page.locator('.media-workbench')).toContainText('预览 v2')
  await expect(page.getByRole('button', { name: '下载候选 PPTX' })).toHaveCount(0)
  snapshot.status = 'WAITING_MEDIA_REVIEW'
  snapshot.stateVersion++
  bundle = structuredClone(presentation)
  bundle.check.previewVersion = 2
  bundle.pages[0]!.preview.checksum = checksum
  await page.getByRole('button', { name: '刷新状态' }).click()
  denied = true
  await page.getByRole('button', { name: '核验第 1 页' }).click()
  await expect(page.locator('.media-workbench')).toContainText('产物当前不可访问')
  await expect(page.getByRole('heading', { name: '理解水循环' })).toHaveCount(0)
  expect(state.requests.filter((r) => r.startsWith('POST /tasks'))).toHaveLength(0)
})

test('运营审计：窗口计数、币种聚合与 afterId 游标', async ({ page }) => {
  await mockBackend(page, { admin: true })
  const cursors: string[] = []
  await page.route('**/api/v1/admin/metrics?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        runs: 12,
        failedRuns: 2,
        incompleteRuns: 1,
        queuedTasks: 3,
        pendingOutbox: 0,
        accessEvents: 5,
        queryCacheHits: 4,
        queryCacheMisses: 9,
        queryCacheEntries: 2,
      }),
    }),
  )
  await page.route('**/api/v1/admin/fees?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          currency: 'CNY',
          attempts: 3,
          unknownAttempts: 1,
          pendingAttempts: 1,
          simulatedAttempts: 0,
          estimatedAmount: '0.12500001',
          reservedAmount: '2.00000000',
        },
      ]),
    }),
  )
  await page.route('**/api/v1/admin/access-audit?*', (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('afterId') ?? ''
    cursors.push(cursor)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        cursor === '0'
          ? [
              {
                id: 17,
                actorUserId: 7,
                action: 'SEARCH_CACHE_HIT',
                resourceId: null,
                scopeMode: null,
                permissionVersion: 1,
                knowledgeEpoch: 2,
                resultCount: 4,
                outcome: null,
                createdAt: '2026-10-05T00:00:00Z',
                knowledgeBaseIds: [12],
                ownerUserId: null,
                resourceIds: [101],
              },
            ]
          : [],
      ),
    })
  })
  await login(page)
  await page.getByRole('link', { name: '运营与审计', exact: true }).click()
  await expect(page.locator('.metrics-grid')).toContainText('12')
  await expect(page.getByText('SEARCH_CACHE_HIT', { exact: true })).toBeVisible()
  await expect(page.getByText('历史未知', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: '读取后续' }).click()
  await expect(page.locator('.page-stepper')).toContainText('游标 17')
  await expect(page.getByRole('button', { name: '读取后续' })).toBeDisabled()
  expect(cursors).toEqual(['0', '17'])
  await page.getByRole('button', { name: '上一页' }).click()
  await expect(page.getByText('SEARCH_CACHE_HIT', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/admin-operations.png', fullPage: true })
})

test('视频规划：真实目录、单片 API 参数、有台词不能无声、未知提交不能编辑重购', async ({
  page,
}) => {
  await mockBackend(page)
  const snapshot = {
    ...modernTask,
    taskType: 'NOTES_VIDEO',
    status: 'WAITING_APPROVAL',
    artifactId: null,
  }
  let preview = {
    ...structuredClone(mediaPreview),
    storyboard: {
      storyboardVersion: 1,
      hash: 'storyboard',
      aspectRatio: '16:9',
      mappingRule: 'registered',
      durationTiers: [5, 10],
      shots: [
        {
          shotId: 'slide1',
          narration: '水汽遇冷，凝成水滴。',
          visualPrompt: '凝结现象',
          motionPrompt: '缓慢展示',
          generationType: 'TEXT_TO_VIDEO',
          referenceAssetIds: [],
          sourceRefs: ['D101v1'],
          estimatedDurationMs: 5000,
          maximumDurationSeconds: 10,
          video: {
            capability: videoCapability,
            resolution: '720p',
            audioMode: 'NATIVE',
            seconds: 5,
            reason: '规划建议',
          },
        },
      ],
    },
  }
  const creates: unknown[] = [],
    selections: unknown[] = []
  await page.route('**/api/v1/media/catalogs', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        ['CHARACTER', 'VOICE', 'SCENE'].map((kind) => ({
          id: kind.toLowerCase(),
          kind,
          version: 1,
          label:
            kind === 'CHARACTER' ? '教学人物甲' : kind === 'VOICE' ? '讲解声音甲' : '教学场景甲',
          enabled: true,
          provider: 'registered',
          mappingKind: 'PROMPT',
          mappingValue: 'registered hint',
          providerMappings: {},
        })),
      ),
    }),
  )
  await page.route('**/api/v1/media/video-capabilities', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([videoCapability]) }),
  )
  await page.route('**/api/v1/tasks', (route) => {
    creates.push(route.request().postDataJSON())
    return route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    })
  })
  await page.route('**/api/v1/tasks/51**', (route) => {
    const path = new URL(route.request().url()).pathname
    const send = (value: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
    if (path.endsWith('/fees')) return send(fee)
    if (path.endsWith('/preview')) return send(preview)
    if (path.endsWith('/video-selection')) {
      selections.push(route.request().postDataJSON())
      preview = { ...preview, previewVersion: preview.previewVersion + 1, estimatedAmount: null }
      snapshot.stateVersion++
      return send(preview)
    }
    if (path.endsWith('/media-operations'))
      return send(
        snapshot.status === 'NEEDS_RECONCILIATION'
          ? [
              {
                operationId: 'original-unknown',
                taskId: 51,
                previewVersion: preview.previewVersion,
                unitId: 'slide1',
                capability: 'VIDEO_GENERATION',
                state: 'UNKNOWN',
                providerJobId: null,
                providerStatus: null,
                pollCount: 0,
                lastPollAt: null,
                nextPollAt: null,
                deadline: null,
                errorCode: 'MEDIA_SUBMISSION_UNKNOWN',
                assetId: null,
                costStatus: 'UNKNOWN',
              },
            ]
          : [],
      )
    return send(snapshot)
  })
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByText('教学视频', { exact: true }).click()
  await expect(page.getByRole('radio', { name: '教学视频', exact: true })).toBeChecked()
  await expect(page.locator('.media-options')).toBeVisible()
  for (const [label, option] of [
    ['教学人物', '教学人物甲'],
    ['原生声音', '讲解声音甲'],
    ['视觉场景', '教学场景甲'],
  ]) {
    const field = page.locator('.media-options .el-form-item').filter({
      has: page.getByRole('combobox', { name: label!, exact: true }),
    })
    await field.locator('.el-select__wrapper').click()
    await page.getByRole('option', { name: new RegExp(option!) }).click()
  }
  await page.getByLabel('主题', { exact: true }).fill('演示凝结现象')
  await page.locator('.document-choice .el-checkbox').click()
  await page.getByRole('button', { name: '创建媒体任务' }).click()
  expect(creates).toEqual([
    expect.objectContaining({
      taskType: 'NOTES_VIDEO',
      strategy: 'PLANNED',
      videoOptions: {
        characterId: 'character',
        voiceId: 'voice',
        sceneId: 'scene',
        seconds: 15,
        maximumAmount: 20,
        shotCount: 3,
        burnSubtitles: false,
      },
    }),
  ])
  await expect(page.locator('.storyboard-list')).toContainText('原生有声')
  await page.getByText('整片 API 与声音规格', { exact: true }).click()
  await page.getByRole('button', { name: '读取登记能力' }).click()
  await page.getByLabel('整片 API', { exact: true }).selectOption('video-native')
  await page.getByLabel('分辨率', { exact: true }).selectOption('720p')
  await page.getByLabel('声音', { exact: true }).selectOption('NONE')
  await page.getByRole('button', { name: '保存选择并重新审批' }).click()
  await expect(page.locator('.media-workbench')).toContainText('无声模式不能保留台词')
  expect(selections).toHaveLength(0)
  await page.getByLabel('声音', { exact: true }).selectOption('NATIVE')
  await page.getByRole('button', { name: '保存选择并重新审批' }).click()
  await expect(page.locator('.media-workbench')).toContainText('预览 v2')
  expect(selections).toEqual([
    {
      previewVersion: 1,
      shots: [
        {
          shotId: 'slide1',
          profileId: 'video-native',
          resolution: '720p',
          audioMode: 'NATIVE',
          seconds: 5,
          reason: '本人选择整片统一 API 与音频规格',
        },
      ],
    },
  ])
  snapshot.status = 'NEEDS_RECONCILIATION'
  snapshot.stateVersion++
  await page.getByRole('button', { name: '刷新状态' }).click()
  await expect(page.getByRole('button', { name: '编辑内容并重新审批' })).toBeDisabled()
  await expect(page.locator('.media-workbench')).toContainText('不能重新购买')
})

test('重设计：375px、横屏与减少动效下无溢出，移动导航支持 Escape', async ({ page }) => {
  await mockBackend(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await login(page)
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '打开导航' }).click()
  await expect(page.locator('.mobile-navigation')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mobile-navigation')).not.toBeVisible()
  await page.getByRole('button', { name: '打开导航' }).click()
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByText('演示文稿', { exact: true }).click()
  await expect(page.getByLabel('演示文稿总页数')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'var/screenshots/tasks-mobile.png', fullPage: true })
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
  await page.getByRole('button', { name: '关闭此对话框', exact: true }).click()
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
test('受控接口：历史 PARTIAL 产物和来源撤销，旧任务不可恢复', async ({ page }) => {
  const state = await mockBackend(page)
  state.document.ingestionStatus = 'RECEIVED'
  state.document.activeProcessingRevision = null
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  state.task.status = 'PAUSED'
  await page.getByLabel('已知任务 ID').fill('51')
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page).toHaveURL(/\/tasks\/51/)
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toHaveCount(0)
  await expect(page.getByText('旧 FAQ／研究报告已停止创建与恢复', { exact: false })).toBeVisible()
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
  await expect(page.getByRole('heading', { name: '单轮问答', level: 1, exact: true })).toBeVisible()
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

test('历史报告：保存的五步进度与覆盖保持可读，停用旧计划入口', async ({ page }) => {
  const state = await mockBackend(page)
  state.task = { ...modernTask }
  await login(page)
  await page.getByRole('link', { name: '学习与制作', exact: true }).click()
  await page.getByLabel('已知任务 ID').fill('51')
  await page.getByRole('button', { name: '打开', exact: true }).click()
  await expect(page.locator('.task-facts')).toContainText('/ 5')
  await expect(page.locator('.active-step')).toHaveCount(2)
  await expect(page.getByText('覆盖未完成', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '查询计划' })).toHaveCount(0)
  expect(state.requests).not.toContain('GET /tasks/51/plan')
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
  const payloadGraph = structuredClone(graph)
  payloadGraph.nodes.push(
    { ...graph.nodes[2]!, spanId: 'read-a', type: 'AGENT', name: 'read_slice1', sequence: 4 },
    { ...graph.nodes[2]!, spanId: 'read-b', type: 'AGENT', name: 'read_slice2', sequence: 5 },
  )
  payloadGraph.run.nodeCount = payloadGraph.nodes.length
  payloadGraph.edges.push(
    { from: 'root', to: 'read-a', kind: 'CALL' },
    { from: 'root', to: 'read-b', kind: 'CALL' },
  )
  payloadGraph.nodes[1]!.input = {
    content: '<img src=x onerror=alert(1)>课程问题',
    truncated: false,
    originalChars: 30,
  }
  payloadGraph.nodes[1]!.output = { content: '课程回答片段', truncated: true, originalChars: 20000 }
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
      body: JSON.stringify({ ...payloadGraph, incomplete: true, missingNodeIds: ['missing-span'] }),
    }),
  )
  await login(page)
  await page.getByRole('link', { name: '运行检查', exact: true }).click()
  await page.getByRole('link', { name: 'trace-1', exact: true }).click()
  await expect(page.getByRole('heading', { name: '运行检查', exact: true })).toBeVisible()
  await expect(page.getByText('运行图不完整', { exact: false })).toBeVisible()
  await expect(page.locator('.run-node-tree')).toHaveCount(0)
  await expect(page.locator('.timeline-row')).toHaveCount(0)
  const readCategory = page.getByRole('button', { name: 'read 2 个节点 总耗时 4000 ms' })
  await expect(readCategory).toHaveAttribute('aria-expanded', 'false')
  await readCategory.focus()
  await page.keyboard.press('Enter')
  await expect(readCategory).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await expect(page.locator('.timeline-node-duration')).toHaveText(['2000 ms', '2000 ms'])
  await page.locator('.timeline-row').getByRole('button', { name: 'read_slice1' }).click()
  await expect(page.getByRole('dialog')).toContainText('节点详情 · read_slice1')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await readCategory.click()
  await expect(page.locator('.timeline-row')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '上一执行' })).toHaveAttribute(
    'href',
    '/runs/trace-old',
  )
  await page.getByRole('button', { name: '查看节点 模型调用', exact: true }).click()
  await expect(page.getByRole('heading', { name: '模型调用', exact: true })).toBeVisible()
  const detail = page.getByRole('dialog')
  await expect(detail.getByText('2000 ms', { exact: false })).toBeVisible()
  await expect(detail.locator('[aria-label="节点输入"] pre')).toHaveText(
    '<img src=x onerror=alert(1)>课程问题',
  )
  await expect(detail.locator('img')).toHaveCount(0)
  await expect(detail.locator('[aria-label="节点输出"]')).toContainText('快照已截断')
  await page.screenshot({ path: 'var/screenshots/run-node-details.png', fullPage: false })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect
    .poll(async () => Math.round((await detail.boundingBox())!.width))
    .toBeLessThanOrEqual(375)
  await expect(detail.getByRole('heading', { name: '节点详情 · 模型调用' })).toBeVisible()
  await page.screenshot({ path: 'var/screenshots/run-node-details-mobile.png', fullPage: false })
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(page.getByText('已知提供方用量：输入 10 / 输出 5', { exact: false })).toBeVisible()
  await expect(page.getByText('费用状态 UNKNOWN', { exact: false })).toBeVisible()
  await readCategory.click()
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'var/screenshots/run-timeline-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'var/screenshots/run-graph.png', fullPage: true })
})
