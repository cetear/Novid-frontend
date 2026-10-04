import { createApp } from 'vue'
import { createPinia } from 'pinia'

import { useAuth } from '@/features/auth'
import { useKnowledgeScope } from '@/features/knowledge'
import { useKnownTasks } from '@/features/tasks'
import { createTransport, configureTransport } from '@/shared/api/transport'
import { router } from './router'
import App from './App.vue'
import '@/shared/styles/main.css'
export function bootstrap() {
  document.documentElement.dataset.density = localStorage.getItem('novid-display') || 'spacious'
  const app = createApp(App),
    pinia = createPinia()
  app.use(pinia)
  const auth = useAuth(),
    knowledge = useKnowledgeScope(),
    tasks = useKnownTasks()
  const transport = createTransport({
    base: import.meta.env.VITE_API_BASE || '/api/v1',
    identity: () => ({ token: auth.token, epoch: auth.epoch }),
    onUnauthorized: () => {
      const next = router.currentRoute.value.fullPath
      auth.reset()
      void router.replace({ path: '/login', query: { redirect: next } })
    },
    onPasswordRequired: () => {
      if (auth.user) auth.user.passwordChangeRequired = true
      transport.abortAll()
      void router.replace('/change-password')
    },
  })
  configureTransport(transport)
  auth.onReset(() => {
    transport.abortAll()
    knowledge.reset()
    tasks.reset()
  })
  app.use(router).mount('#app')
}
