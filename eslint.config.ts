import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  globalIgnores([
    'dist/**',
    'scaffold/**',
    'node_modules/**',
    '.*cache/**',
    '.pnpm*/**',
    '.npm/**',
    'test-results/**',
    'playwright-report/**',
  ]),
  { files: ['**/*.{ts,vue}'] },
  ...vue.configs['flat/essential'],
  vueTsConfigs.recommended,
  { rules: { 'vue/multi-word-component-names': 'off' } },
  prettier,
)
