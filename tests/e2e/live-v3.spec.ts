import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  loginSchema,
  baseSchema,
  documentSchema,
  contentSchema,
  taskSchema,
} from '../../src/shared/api/contracts/backend'
import { contentPlanSchema, packageStatusSchema } from '../../src/shared/api/contracts/contentPlan'
import { learningResultSchema } from '../../src/shared/api/contracts/learning'
import {
  readPlanSchema,
  compilationSaveSchema,
  originSchema,
  participationSchema,
} from '../../src/shared/api/contracts/workflow'
import { z } from 'zod'
test('真实 V3：单资料自测、整编保存、来源绑定及 PPT V2', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(7_200_000)
  const marker = 'v3-' + crypto.randomUUID().slice(0, 8),
    tasks: number[] = [],
    checks: Array<{ name: string; status: string; detail: unknown }> = [],
    cleanup: unknown[] = []
  const evidence: Record<string, unknown> = {
    marker,
    startedAt: new Date().toISOString(),
    tasks,
    checks,
    cleanup,
    realServices: true,
  }
  let token = '',
    baseId = 0,
    documentId = 0
  const save = async () => {
    await mkdir('var/live', { recursive: true })
    await writeFile('var/live/v3-2026-10-11.json', JSON.stringify(evidence, null, 2))
  }
  async function api(
    path: string,
    method = 'GET',
    data?: unknown,
    expected = 200,
    key = crypto.randomUUID(),
  ) {
    const r = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      timeout: 90000,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(method === 'POST' ? { 'Idempotency-Key': key } : {}),
      },
    })
    if (r.status() !== expected) {
      const body = await r.json().catch(() => ({}))
      throw new Error(`${method} ${path}: HTTP ${r.status()} / ${body.code ?? 'HTTP_ERROR'}`)
    }
    return r
  }
  async function check(name: string, action: () => Promise<unknown>) {
    console.info('[真实 V3] ' + name)
    try {
      checks.push({ name, status: 'PASS', detail: await action() })
    } catch (e) {
      checks.push({
        name,
        status: 'FAIL',
        detail: e instanceof Error ? e.message.slice(0, 1600) : '失败',
      })
    }
    await save()
  }
  async function openPrivate(path: string) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await expect(page).toHaveURL(/\/login/, { timeout: 60000 })
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const next = page
      .waitForResponse((r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST')
      .then(async (r) => loginSchema.parse(await r.json()))
    await page.getByRole('button', { name: '登录工作台' }).click()
    const identity = await next
    await api('/auth/logout', 'POST')
    token = identity.token
    await expect(page).toHaveURL(
      new RegExp(path.split('?')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
  }
  async function ready(id: number) {
    await expect
      .poll(
        async () =>
          contentSchema.parse(await (await api('/documents/' + id)).json()).document
            .ingestionStatus,
        { timeout: 300000, intervals: [3000] },
      )
      .toBe('READY')
    return contentSchema.parse(await (await api('/documents/' + id)).json()).document
  }
  async function create(type: string, ids: number[], remarks = '') {
    const task = taskSchema.parse(
      await (
        await api(
          '/tasks',
          'POST',
          {
            taskType: type,
            scope: { mode: 'SELECTED', knowledgeBaseIds: [baseId], ownerUserId: null },
            documentIds: ids,
            strategy: 'FIXED',
            ...(remarks ? { remarks } : {}),
            ...(type === 'QUIZ_GENERATION'
              ? {
                  quizOptions: {
                    questionCount: 0,
                    questionTypes: ['SINGLE_CHOICE', 'SHORT_ANSWER'],
                    difficulty: 'MEDIUM',
                  },
                }
              : type === 'KNOWLEDGE_COMPILATION'
                ? { compilationOptions: { detailLevel: 'CONCISE', maximumChapters: 0 } }
                : {
                    presentationOptions: {
                      pageCount: 0,
                      themeId: 'default',
                      imagePolicy: 'CONCEPT',
                      maximumAmount: 30,
                    },
                  }),
          },
          202,
        )
      ).json(),
    )
    tasks.push(task.taskId)
    await save()
    return task.taskId
  }
  async function observe(id: number) {
    const deadline = Date.now() + 2700000
    let previous = ''
    while (Date.now() < deadline) {
      const task = taskSchema.parse(await (await api('/tasks/' + id)).json())
      evidence['task' + id] = task
      await save()
      const state = task.status + ':' + task.completedSteps
      if (state !== previous) {
        console.info(`[真实 V3] 任务 ${id}: ${state} ${task.errorCode ?? ''}`)
        previous = state
      }
      if (!['QUEUED', 'RUNNING'].includes(task.status)) return task
      await new Promise((r) => setTimeout(r, 5000))
    }
    throw new Error('45 分钟观察结束，任务仍未终结')
  }
  async function snapshots(id: number) {
    const readR = await api('/tasks/' + id + '/read-plan', 'GET', undefined, 200)
    expect(readR.headers()['cache-control']).toContain('no-store')
    const read = readPlanSchema.parse(await readR.json())
    evidence['read' + id] = read
    const planR = await page.request.get('/api/v1/tasks/' + id + '/content-plan', {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (planR.status() === 200) evidence['plan' + id] = contentPlanSchema.parse(await planR.json())
    else expect(planR.status()).toBe(204)
    const packs = z
      .array(packageStatusSchema)
      .parse(await (await api('/tasks/' + id + '/work-packages?page=0&size=20')).json())
    evidence['packages' + id] = packs
    await save()
    return {
      fragments: read.plan.fragments.length,
      read: read.fullSourceRead,
      packages: packs.length,
    }
  }
  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page
      .getByLabel('用户名', { exact: true })
      .fill(process.env.NOVID_TEST_USERNAME!, { timeout: 60000 })
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const login = page
      .waitForResponse((r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST')
      .then(async (r) => {
        expect(r.status()).toBe(200)
        return loginSchema.parse(await r.json())
      })
    await page.getByRole('button', { name: '登录工作台' }).click()
    token = (await login).token
    const base = baseSchema.parse(
      await (
        await api('/knowledge-bases', 'POST', {
          name: marker,
          description: 'V3 前端真实联调合成资料，结束后清理',
        })
      ).json(),
    )
    baseId = base.id
    const upload = await page.request.post('/api/v1/documents', {
      headers: { Authorization: 'Bearer ' + token, 'Idempotency-Key': crypto.randomUUID() },
      multipart: {
        knowledgeBaseId: String(baseId),
        file: {
          name: marker + '.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from(
            '# 备份规则\n\n每周三 21:30 执行备份。备份文件保留七天。\n\n## 恢复检查\n\n恢复后核对校验和；校验和一致才确认恢复通过。',
          ),
        },
      },
    })
    expect(upload.status()).toBe(202)
    documentId = documentSchema.parse(await upload.json()).id
    evidence.baseId = baseId
    evidence.documentId = documentId
    await save()
    await check('真实入库与上传来源', async () => {
      const doc = await ready(documentId)
      const origin = originSchema.parse(
        await (await api('/documents/' + documentId + '/origin')).json(),
      )
      expect(origin.originType).toBe('UPLOAD')
      return { document: doc, origin }
    })
    await check('拒绝多资料自测', async () => {
      await api(
        '/tasks',
        'POST',
        {
          taskType: 'QUIZ_GENERATION',
          scope: { mode: 'SELF', knowledgeBaseIds: [], ownerUserId: null },
          documentIds: [documentId, documentId],
        },
        400,
      )
      return '多资料/重复资料请求 HTTP 400，无任务创建'
    })
    const quiz = await create('QUIZ_GENERATION', [documentId])
    await check('真实单资料自测结果', async () => {
      const task = await observe(quiz)
      await snapshots(quiz)
      expect(task.status, task.errorCode ?? '').toBe('SUCCEEDED')
      const result = learningResultSchema.parse(
        await (await api('/tasks/' + quiz + '/result')).json(),
      )
      expect(result.contentPlan.version).toBe(3)
      evidence['result' + quiz] = result
      await writeFile(
        `var/live/v3-task-${quiz}.md`,
        await (await api('/artifacts/' + task.artifactId)).text(),
      )
      await openPrivate('/tasks/' + quiz)
      await page.getByRole('button', { name: '核验并查看学习结果' }).click()
      await expect(page.locator('.content-plan')).toContainText('章节验收')
      return {
        taskId: quiz,
        questions: result.quiz?.questions.length,
        coverage: result.coverageReport.length,
      }
    })
    const compilation = await create('KNOWLEDGE_COMPILATION', [documentId])
    let savedId = 0
    await check('真实整编与保存确认、幂等重放', async () => {
      const task = await observe(compilation)
      await snapshots(compilation)
      expect(task.status, task.errorCode ?? '').toBe('SUCCEEDED')
      const result = learningResultSchema.parse(
        await (await api('/tasks/' + compilation + '/result')).json(),
      )
      evidence['result' + compilation] = result
      await writeFile(
        `var/live/v3-task-${compilation}.md`,
        await (await api('/artifacts/' + task.artifactId)).text(),
      )
      const key = crypto.randomUUID()
      const prepared = compilationSaveSchema.parse(
        await (
          await api(
            '/tasks/' + compilation + '/compilation-save/prepare',
            'POST',
            { knowledgeBaseId: baseId },
            200,
            key,
          )
        ).json(),
      )
      const replay = compilationSaveSchema.parse(
        await (
          await api(
            '/tasks/' + compilation + '/compilation-save/prepare',
            'POST',
            { knowledgeBaseId: baseId },
            200,
            key,
          )
        ).json(),
      )
      expect(replay.approval.approvalId).toBe(prepared.approval.approvalId)
      expect(prepared.document).toBeNull()
      evidence.saveApproval = prepared.approval.approvalId
      await save()
      await openPrivate('/approvals/' + prepared.approval.approvalId + '?compilationSave=1')
      await page.getByRole('button', { name: '已核对，批准保存' }).click()
      await expect(
        page.getByText('笔记已保存为文档；索引仍需后台处理。', { exact: true }),
      ).toBeVisible({ timeout: 60000 })
      const status = compilationSaveSchema.parse(
        await (await api('/compilation-saves/' + prepared.approval.approvalId)).json(),
      )
      expect(status.document).not.toBeNull()
      savedId = status.document!.id
      evidence.savedDocumentId = savedId
      await ready(savedId)
      const origin = originSchema.parse(
        await (await api('/documents/' + savedId + '/origin')).json(),
      )
      evidence.origin = origin
      expect(origin.originType).toBe('KNOWLEDGE_COMPILATION')
      expect(origin.mappingValid).toBe(true)
      expect(origin.bindingStatus).toBe('BOUND')
      const participation = z
        .array(participationSchema)
        .parse(
          await (await api('/documents/' + documentId + '/compilations?page=0&size=20')).json(),
        )
      expect(participation.some((p) => p.documentId === savedId)).toBe(true)
      return { taskId: compilation, savedId, bindings: origin.parsedBindings.length }
    })
    await check('真实工作包分页边界与保存权限守卫', async () => {
      await api('/tasks/' + compilation + '/work-packages?page=-1&size=20', 'GET', undefined, 400)
      await api('/tasks/' + compilation + '/work-packages?page=0&size=101', 'GET', undefined, 400)
      await api('/compilation-saves/' + crypto.randomUUID(), 'GET', undefined, 403)
      const current = taskSchema.parse(await (await api('/tasks/' + compilation)).json())
      if (current.status === 'FAILED') {
        const denied = await api(
          '/tasks/' + compilation + '/compilation-save/prepare',
          'POST',
          { knowledgeBaseId: baseId },
          409,
        )
        expect((await denied.json()).code).toBe('WORKFLOW_RESULT_UNAVAILABLE')
      }
      return {
        pagination: 'HTTP 400',
        unknownSave: 'HTTP 403',
        failedSave: current.status === 'FAILED' ? 'HTTP 409' : '不适用',
      }
    })
    if (savedId) {
      const savedQuiz = await create('QUIZ_GENERATION', [savedId])
      await check('生成资料单文档自测继承章节映射', async () => {
        const t = await observe(savedQuiz)
        await snapshots(savedQuiz)
        expect(t.status, t.errorCode ?? '').toBe('SUCCEEDED')
        const result = learningResultSchema.parse(
          await (await api('/tasks/' + savedQuiz + '/result')).json(),
        )
        evidence['result' + savedQuiz] = result
        expect(
          result.contentPlan.quiz?.chapters.some((c) => c.origin === 'COMPILATION_MAPPING'),
        ).toBe(true)
        return { taskId: savedQuiz }
      })
    }
    const ppt = await create('NOTES_PPT', [documentId], '用于简短教学，不需要配图。')
    await check('PPT 保持 V2 内容计划与来源页计数', async () => {
      const t = await observe(ppt)
      await snapshots(ppt)
      expect(t.status, t.errorCode ?? '').toBe('WAITING_APPROVAL')
      const plan = contentPlanSchema.parse(
        await (await api('/tasks/' + ppt + '/content-plan')).json(),
      )
      expect(plan.plan.version).toBe(2)
      expect(plan.plan.counts.totalSlides).toBe(
        plan.plan.counts.contentSlides + plan.plan.counts.sourceSlides,
      )
      return { taskId: ppt, counts: plan.plan.counts }
    })
  } catch (e) {
    checks.push({
      name: '环境或主流程',
      status: 'FAIL',
      detail: e instanceof Error ? e.message : '失败',
    })
  } finally {
    for (const id of tasks)
      try {
        const t = taskSchema.parse(await (await api('/tasks/' + id)).json())
        if (
          [
            'QUEUED',
            'RUNNING',
            'PAUSED',
            'WAITING_APPROVAL',
            'WAITING_MEDIA_REVIEW',
            'WAITING_EXTERNAL',
          ].includes(t.status)
        )
          await api('/tasks/' + id + '/actions', 'POST', { action: 'cancel' })
        cleanup.push({
          taskId: id,
          status: taskSchema.parse(await (await api('/tasks/' + id)).json()).status,
        })
      } catch {
        cleanup.push({ taskId: id, status: '未确认' })
      }
    if (baseId)
      try {
        const b = baseSchema.parse(await (await api('/knowledge-bases/' + baseId)).json())
        await api('/knowledge-bases/' + baseId + '?version=' + b.version, 'DELETE')
        cleanup.push({ baseId, status: '逻辑删除' })
      } catch {
        cleanup.push({ baseId, status: '未确认' })
      }
    if (token)
      try {
        await api('/auth/logout', 'POST')
        cleanup.push({ token: 'REVOKED' })
      } catch {
        cleanup.push({ token: '未确认' })
      }
    evidence.finishedAt = new Date().toISOString()
    await save()
  }
  expect(checks.filter((c) => c.status === 'FAIL')).toEqual([])
})
