import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
if (existsSync('.env.live.local')) process.loadEnvFile('.env.live.local')
const live = process.argv.some(
  (arg, index, args) =>
    arg === '--project=live' || (arg === '--project' && args[index + 1] === 'live'),
)
const port = live ? 5173 : 4173
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'contract',
      testMatch: '**/contract.spec.ts',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'live',
      testMatch: '**/live*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        baseURL: 'http://127.0.0.1:5173',
        trace: 'off',
        screenshot: 'off',
      },
    },
  ],
  webServer: {
    command: live
      ? 'pnpm dev --host 127.0.0.1 --strictPort'
      : 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
