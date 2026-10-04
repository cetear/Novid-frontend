import { fileURLToPath, URL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// 枚举真实样式入口：当前依赖的 exports.types 会使 Vite 的 glob 展开漏掉这些模块。
// 在冷启动时预构建，避免首次打开新页面触发整页重载并丢失内存登录。
const componentDirectory = new URL('./components/', import.meta.resolve('element-plus/es'))
const componentStyles = readdirSync(componentDirectory, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(new URL(`${entry.name}/style/css.mjs`, componentDirectory)),
  )
  .map((entry) => `element-plus/es/components/${entry.name}/style/css`)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET || 'http://localhost:8080'
  return {
    plugins: [
      vue(),
      Components({
        resolvers: [ElementPlusResolver({ importStyle: 'css', directives: true })],
        dts: 'src/components.d.ts',
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.vue'],
      include: [
        'vue',
        'vue-router',
        'pinia',
        'element-plus/es',
        ...componentStyles,
        'element-plus/es/locale/lang/zh-cn',
        '@element-plus/icons-vue',
        'zod',
        'dompurify',
        'markdown-it',
        'eventsource-parser',
      ],
    },
    server: {
      watch: {
        ignored: ['**/playwright-report/**', '**/test-results/**', '**/var/**', '**/scaffold/**'],
      },
      host: '127.0.0.1',
      proxy: {
        '/api': { target, changeOrigin: true, timeout: 100_000, proxyTimeout: 100_000 },
        '/actuator/health': { target, changeOrigin: true },
      },
    },
    build: { target: ['chrome120', 'edge120'], chunkSizeWarningLimit: 700 },
  }
})
