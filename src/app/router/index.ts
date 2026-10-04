import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/features/auth'
export { safeReturn } from '@/shared/lib/routing'
import { safeReturn } from '@/shared/lib/routing'
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/chat' },
    {
      path: '/login',
      component: () => import('@/features/auth/pages/LoginPage.vue'),
      meta: { public: true },
    },
    {
      path: '/change-password',
      component: () => import('@/features/settings/pages/PasswordPage.vue'),
    },
    { path: '/settings', component: () => import('@/features/settings/pages/SettingsPage.vue') },
    { path: '/chat', component: () => import('@/features/chat/pages/ChatPage.vue') },
    {
      path: '/knowledge-bases',
      component: () => import('@/features/knowledge/pages/BasesPage.vue'),
    },
    {
      path: '/knowledge-bases/:id',
      component: () => import('@/features/knowledge/pages/BasePage.vue'),
    },
    {
      path: '/documents/:id',
      component: () => import('@/features/knowledge/pages/DocumentPage.vue'),
    },
    {
      path: '/approvals/:approvalId',
      component: () => import('@/features/approvals/pages/ApprovalPage.vue'),
    },
    { path: '/tasks', component: () => import('@/features/tasks/pages/TasksPage.vue') },
    { path: '/tasks/:id', component: () => import('@/features/tasks/pages/TaskPage.vue') },
    { path: '/memories', component: () => import('@/features/memories/pages/MemoriesPage.vue') },
    { path: '/runs', component: () => import('@/features/runs/pages/RunsPage.vue') },
    { path: '/run-inspector.html', redirect: '/runs' },
    { path: '/runs/:traceId', component: () => import('@/features/runs/pages/RunPage.vue') },
    {
      path: '/admin/users',
      component: () => import('@/features/admin/pages/UsersPage.vue'),
      meta: { admin: true },
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('@/app/layouts/NotFound.vue'),
      meta: { public: true },
    },
  ],
})
router.beforeEach((to) => {
  const auth = useAuth()
  if (auth.token && Date.parse(auth.expiresAt) <= Date.now()) auth.reset()
  if (!to.meta.public && !auth.token)
    return { path: '/login', query: { redirect: safeReturn(to.fullPath) } }
  if (auth.user?.passwordChangeRequired && !['/change-password', '/login'].includes(to.path))
    return '/change-password'
  if (to.meta.admin && auth.user?.role !== 'ADMIN') return '/chat'
  if (to.path === '/login' && auth.token)
    return auth.user?.passwordChangeRequired ? '/change-password' : '/chat'
})
