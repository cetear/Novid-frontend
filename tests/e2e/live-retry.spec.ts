import { test, expect } from '@playwright/test'
import { loginSchema } from '../../src/shared/api/contracts/backend'
import { retryPlanSchema } from '../../src/shared/api/contracts/taskRetry'
test('真实续跑：失败整编资格、拒绝原因与原任务页面', async ({ page }) => {
  test.skip(!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD, '缺少受控账号')
  test.setTimeout(120000)
  const taskId = Number(process.env.NOVID_RETRY_TASK_ID || 203)
  let token = ''
  try {
    await page.goto('/tasks/' + taskId)
    await page.getByLabel('用户名', { exact: true }).fill(process.env.NOVID_TEST_USERNAME!)
    await page.getByLabel('密码', { exact: true }).fill(process.env.NOVID_TEST_PASSWORD!)
    const auth = page
      .waitForResponse((r) => r.url().endsWith('/auth/login'))
      .then(async (r) => loginSchema.parse(await r.json()))
    await page.getByRole('button', { name: '登录工作台' }).click()
    token = (await auth).token
    await expect(page).toHaveURL(new RegExp('/tasks/' + taskId + '$'))
    const api = await page.request.get('/api/v1/tasks/' + taskId + '/retry-plan', {
      headers: { Authorization: 'Bearer ' + token },
    })
    expect(api.status()).toBe(200)
    expect(api.headers()['cache-control']).toContain('no-store')
    const plan = retryPlanSchema.parse(await api.json())
    const response = page.waitForResponse((r) => r.url().endsWith('/retry-plan'))
    await page.getByRole('button', { name: '查询续跑资格' }).click()
    expect((await response).status()).toBe(200)
    expect(plan.taskId).toBe(taskId)
    await expect(page.locator('.compilation-retry')).toContainText(
      '已验收包 ' + plan.acceptedPackages,
    )
    if (!plan.canContinue) {
      await expect(page.getByRole('button', { name: '继续原整编任务', exact: true })).toBeDisabled()
      for (const reason of plan.blockers)
        await expect(page.locator('.compilation-retry')).toContainText(reason)
    }
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    if (token)
      expect(
        (
          await page.request.post('/api/v1/auth/logout', {
            headers: { Authorization: 'Bearer ' + token },
          })
        ).status(),
      ).toBe(200)
  }
})
