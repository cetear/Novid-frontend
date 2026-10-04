<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ref } from 'vue'
import { useAuth, authApi } from '@/features/auth'
import { dateTime } from '@/shared/lib/format'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const auth = useAuth(),
  router = useRouter(),
  { busy, error, run } = useAction()
const spacious = ref(localStorage.getItem('novid-display') !== 'compact')
function setDisplay(value: boolean) {
  localStorage.setItem('novid-display', value ? 'spacious' : 'compact')
  document.documentElement.dataset.density = value ? 'spacious' : 'compact'
}
function logout() {
  void run(async () => {
    try {
      await authApi.logout()
    } finally {
      auth.reset()
      await router.replace('/login')
    }
  })
}
</script>
<template>
  <PageHeader
    eyebrow="YOUR ACCOUNT"
    title="账户设置"
    description="管理登录安全与工作台显示偏好。"
  />
  <div class="panel narrow-panel">
    <Feedback :error="error" />
    <h2>{{ auth.user?.username }}</h2>
    <el-descriptions :column="1"
      ><el-descriptions-item label="账户 ID">#{{ auth.user?.id }}</el-descriptions-item
      ><el-descriptions-item label="角色">{{ auth.user?.role }}</el-descriptions-item
      ><el-descriptions-item label="本次登录到期">{{
        auth.expiresAt ? dateTime(auth.expiresAt) : '—'
      }}</el-descriptions-item></el-descriptions
    >
    <div class="setting-row">
      <span>宽松显示间距</span
      ><el-switch
        v-model="spacious"
        aria-label="宽松显示间距"
        @change="setDisplay(Boolean($event))"
      />
    </div>
    <div class="toolbar">
      <el-button type="primary" @click="router.push('/change-password')">修改密码</el-button
      ><el-button :loading="busy" @click="logout">退出登录</el-button>
    </div>
    <p class="muted small">登录信息仅存于内存。刷新页面后，请重新登录。</p>
  </div>
</template>
