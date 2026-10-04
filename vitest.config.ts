import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' }),
  defineConfig({
    test: { environment: 'jsdom', include: ['tests/integration/**/*.test.ts'], restoreMocks: true },
  }),
)
