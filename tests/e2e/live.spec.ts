import { test, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { baseSchema, userSchema } from '../../src/shared/api/contracts/backend'

test('真实后端：未登录访问限制与无效凭证提示', async ({ page, request }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  for (const path of ['/auth/me', '/knowledge-bases', '/admin/users', '/memories']) {
    const response = await request.get('/api/v1' + path)
    expect(response.status()).toBe(401)
    expect((await response.json()).code).toBe('AUTH_REQUIRED')
  }
  await page.goto('/knowledge-bases')
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('用户名', { exact: true }).fill('probe_' + crypto.randomUUID())
  await page.getByLabel('密码', { exact: true }).fill('invalid-probe-only')
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '登录工作台' }).click()
  expect((await responsePromise).status()).toBe(401)
  await expect(page.locator('.el-alert--error')).toBeVisible()
  await expect(page.getByRole('button', { name: '登录工作台' })).toBeEnabled()
  await expect(page).toHaveURL(/\/login/)
  expect(
    await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]),
  ).not.toContain('token')
  expect(pageErrors).toEqual([])
})

test('真实后端：管理员建号、首次改密与普通用户权限', async ({ page, browser }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(120_000)
  page.setDefaultTimeout(15_000)
  const username = 'frontend_user_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const newPassword = 'Live-' + crypto.randomUUID()
  const results: Record<string, unknown> = { startedAt: new Date().toISOString() }
  let adminToken = '',
    userToken = '',
    userId = 0,
    userBaseId = 0,
    adminBaseId = 0
  const userContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const userPage = await userContext.newPage()
  userPage.setDefaultTimeout(15_000)
  const navigationRequests: string[] = []
  const authResponses: { path: string; status: number }[] = []
  userPage.on('request', (request) => {
    if (request.isNavigationRequest() && request.resourceType() === 'document')
      navigationRequests.push(new URL(request.url()).pathname)
  })
  userPage.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (path.startsWith('/api/v1/auth/')) authResponses.push({ path, status: response.status() })
  })
  async function request(
    path: string,
    token: string,
    method = 'GET',
    data?: unknown,
    status = 200,
  ) {
    const response = await page.request.fetch('/api/v1' + path, {
      method,
      data,
      headers: { Authorization: 'Bearer ' + token },
    })
    expect(response.status(), method + ' ' + path).toBe(status)
    return response
  }
  try {
    await page.goto('/login')
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const adminLogin = page.waitForResponse(
      (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    )
    const adminMe = page.waitForRequest(
      (r) => r.url().endsWith('/auth/me') && !!r.headers().authorization,
    )
    await page.getByRole('button', { name: '登录工作台' }).click()
    expect((await adminLogin).status()).toBe(200)
    adminToken = (await adminMe).headers().authorization!.slice(7)
    const administrator = userSchema.parse(await (await request('/auth/me', adminToken)).json())
    test.skip(administrator.role !== 'ADMIN', '该账户不是管理员，未创建测试用户')
    await page.getByRole('link', { name: '用户管理', exact: true }).click()
    await page.getByLabel('新用户用户名', { exact: true }).fill(username)
    await page.getByRole('button', { name: '创建用户', exact: true }).click()
    await expect(page.locator('.temporary-password')).toBeVisible()
    const temporary = (await page.locator('.temporary-password').textContent())!.trim()
    expect(temporary.length > 12).toBe(true)
    const users = await (await request('/admin/users?page=0&size=100', adminToken)).json()
    const created = users
      .map((value: unknown) => userSchema.parse(value))
      .find((value: { username: string }) => value.username === username)
    expect(created).toBeDefined()
    userId = created.id
    results.createdUserId = userId
    expect(created.role).toBe('USER')
    expect(created.passwordChangeRequired).toBe(true)
    await page.getByRole('button', { name: '已记录，关闭', exact: true }).click()
    await expect(page.locator('.temporary-password')).toBeHidden()
    results.closedDialogRetainsPassword = (
      (await page.locator('.temporary-password').textContent()) || ''
    ).includes(temporary)
    expect(results.closedDialogRetainsPassword).toBe(false)
    results.createUser = 'PASS'

    await userPage.goto('/login')
    await userPage.getByLabel('用户名', { exact: true }).fill(username)
    await userPage.getByLabel('密码', { exact: true }).fill(temporary)
    const temporaryLogin = userPage.waitForResponse(
      (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    )
    const temporaryMe = userPage.waitForRequest(
      (r) => r.url().endsWith('/auth/me') && !!r.headers().authorization,
    )
    await userPage.getByRole('button', { name: '登录工作台' }).click()
    expect((await temporaryLogin).status()).toBe(200)
    userToken = (await temporaryMe).headers().authorization!.slice(7)
    await expect(userPage).toHaveURL(/\/change-password/)
    await request('/knowledge-bases', userToken, 'GET', undefined, 403)
    await userPage.getByLabel('原密码 / 临时密码').fill('wrong-old-password')
    await userPage.getByLabel('新密码', { exact: true }).fill(newPassword)
    await userPage.getByLabel('确认新密码', { exact: true }).fill(newPassword)
    await userPage.getByRole('button', { name: '确认修改', exact: true }).click()
    await expect(userPage.getByText('原密码不正确', { exact: false })).toBeVisible()
    await expect(userPage).toHaveURL(/\/change-password/)
    await request('/auth/me', userToken)
    await userPage.getByLabel('原密码 / 临时密码').fill(temporary)
    await userPage.getByRole('button', { name: '确认修改', exact: true }).click()
    await expect(userPage).toHaveURL(/\/login/)
    await request('/auth/me', userToken, 'GET', undefined, 401)
    results.firstPasswordChange = 'PASS（原密码错误不登出；成功后旧令牌失效）'
    await userPage.getByLabel('用户名', { exact: true }).fill(username)
    await userPage.getByLabel('密码', { exact: true }).fill(newPassword)
    const renewedLogin = userPage.waitForResponse(
      (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    )
    const renewedMe = userPage.waitForRequest(
      (r) => r.url().endsWith('/auth/me') && !!r.headers().authorization,
    )
    await userPage.getByRole('button', { name: '登录工作台' }).click()
    expect((await renewedLogin).status()).toBe(200)
    userToken = (await renewedMe).headers().authorization!.slice(7)
    await expect(userPage).toHaveURL(/\/chat/)
    expect(navigationRequests).toEqual(['/login'])
    await expect(userPage.getByRole('link', { name: '用户管理', exact: true })).toHaveCount(0)
    await request('/admin/users', userToken, 'GET', undefined, 403)
    await request('/knowledge-bases?scopeMode=ALL', userToken, 'GET', undefined, 403)

    const userBase = baseSchema.parse(
      await (
        await request('/knowledge-bases', userToken, 'POST', {
          name: username + '-owned',
          description: '普通用户权限验收',
        })
      ).json(),
    )
    userBaseId = userBase.id
    const adminBase = baseSchema.parse(
      await (
        await request('/knowledge-bases', adminToken, 'POST', {
          name: username + '-admin-owned',
          description: '管理员权限验收',
        })
      ).json(),
    )
    adminBaseId = adminBase.id
    await request('/knowledge-bases/' + adminBaseId, userToken, 'GET', undefined, 403)
    const readByAdmin = baseSchema.parse(
      await (await request('/knowledge-bases/' + userBaseId, adminToken)).json(),
    )
    expect(readByAdmin.ownerUserId).toBe(userId)
    await request(
      '/knowledge-bases/' + userBaseId,
      adminToken,
      'PATCH',
      { version: userBase.version, name: '禁止跨库修改', description: '', enabled: true },
      403,
    )
    await request(
      '/knowledge-bases/' + userBaseId + '?version=' + userBase.version,
      adminToken,
      'DELETE',
      undefined,
      403,
    )
    results.readAndWriteIsolation = 'PASS（普通用户不能读他人库；管理员跨库只读）'
    await request(
      '/knowledge-bases/' + userBaseId + '?version=' + userBase.version,
      userToken,
      'DELETE',
    )
    userBaseId = 0
    await request(
      '/knowledge-bases/' + adminBaseId + '?version=' + adminBase.version,
      adminToken,
      'DELETE',
    )
    adminBaseId = 0

    await request('/admin/users/' + userId, adminToken, 'PATCH', { enabled: false, role: 'USER' })
    await request('/auth/me', userToken, 'GET', undefined, 401)
    await userPage.getByRole('link', { name: '知识库', exact: true }).click()
    await expect(userPage).toHaveURL(/\/login/)
    results.accountRevocation = 'PASS（禁用撤销登录，页面清理身份）'
    results.completed = true
  } finally {
    if (userBaseId && userToken) {
      const base = baseSchema.parse(
        await (await request('/knowledge-bases/' + userBaseId, userToken)).json(),
      )
      await request(
        '/knowledge-bases/' + userBaseId + '?version=' + base.version,
        userToken,
        'DELETE',
      )
    }
    if (adminBaseId && adminToken) {
      const base = baseSchema.parse(
        await (await request('/knowledge-bases/' + adminBaseId, adminToken)).json(),
      )
      await request(
        '/knowledge-bases/' + adminBaseId + '?version=' + base.version,
        adminToken,
        'DELETE',
      )
    }
    if (userId && adminToken)
      await request('/admin/users/' + userId, adminToken, 'PATCH', { enabled: false, role: 'USER' })
    if (adminToken) await request('/auth/logout', adminToken, 'POST')
    await userContext.close()
    results.cleanup = '仅本次创建的知识库已删除；测试用户已禁用，账户无删除 API。'
    results.navigationRequests = navigationRequests
    results.authResponses = authResponses
    results.finishedAt = new Date().toISOString()
    await mkdir('var/live', { recursive: true })
    await writeFile('var/live/permissions.json', JSON.stringify(results, null, 2) + '\n')
  }
})

test('真实后端：受控账户登录、资料读取、退出', async ({ page }) => {
  test.skip(
    !process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD,
    '需要后端负责人提供受控测试账号；不使用 Mock 代替真实验收',
  )
  await page.goto('/login')
  await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
  await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
  await page.getByRole('button', { name: '登录工作台' }).click()
  await expect(page).toHaveURL(/\/chat/)
  await page.getByRole('link', { name: '知识库', exact: true }).click()
  await expect(page.getByRole('heading', { name: '知识，妥善收纳。' })).toBeVisible()
  await expect(page.locator('.el-alert--error')).toHaveCount(0)
  await page.locator('.profile').click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
})
