import { test, expect } from '@playwright/test'
import { mockBackend, login } from './mockBackend'
import { session, modernTask, plan, graph, ingestion, sectionPage } from '../stageFixtures'
import { ai } from '../fixtures'
import { fee, mediaPreview, presentation, videoCapability } from '../mediaFixtures'
import { createHash } from 'node:crypto'
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
    if (path.endsWith('/media-operations')) return send([])
    if (path.endsWith('/media-review')) {
      reviews.push(route.request().postDataJSON())
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
  await page.getByRole('link', { name: '报告任务', exact: true }).click()
  await page.getByLabel('已知任务 ID').fill('51')
  await page.getByRole('button', { name: '打开', exact: true }).click()
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
                scopeMode: 'SELECTED',
                permissionVersion: 1,
                knowledgeEpoch: 2,
                resultCount: 4,
                outcome: 'DELIVERABLE',
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
  await page.getByRole('link', { name: '报告任务', exact: true }).click()
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
  await page.getByRole('button', { name: '创建规划任务' }).click()
  expect(creates).toEqual([
    expect.objectContaining({
      taskType: 'NOTES_VIDEO',
      strategy: 'PLANNED',
      videoOptions: {
        characterId: 'character',
        voiceId: 'voice',
        sceneId: 'scene',
        seconds: 15,
        maximumAmount: '20',
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
  await page.getByRole('link', { name: '报告任务', exact: true }).click()
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
  await page.locator('.session-panel > summary').click()
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
