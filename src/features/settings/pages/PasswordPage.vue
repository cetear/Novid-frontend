<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ApiError } from '@/shared/api/errors'
import { useAuth, authApi } from '@/features/auth'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const auth = useAuth(),
  router = useRouter(),
  oldPassword = ref(''),
  newPassword = ref(''),
  confirm = ref('')
const { busy, error, run } = useAction()
function change() {
  void run(async () => {
    if (newPassword.value !== confirm.value) throw new Error('两次新密码输入不一致')
    try {
      await authApi.password(oldPassword.value, newPassword.value)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        try {
          await authApi.me()
        } catch (verify) {
          if (verify instanceof ApiError && verify.status === 401) throw verify
          throw new Error('暂时无法核验登录，请稍后再试')
        }
        throw new Error('原密码不正确，请重新输入')
      }
      throw e
    }
    auth.reset()
    oldPassword.value = ''
    newPassword.value = ''
    confirm.value = ''
    await router.replace({ path: '/login', query: { changed: '1' } })
  })
}
async function logout() {
  await run(async () => {
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
    eyebrow="ACCOUNT SECURITY"
    :title="auth.user?.passwordChangeRequired ? '设置你的专属密码' : '修改密码'"
    description="新密码须为 12～64 个字符，且不超过 72 个 UTF-8 字节。修改成功后需要重新登录。"
  />
  <div class="panel narrow-panel">
    <Feedback :error="error" /><el-form label-position="top" @submit.prevent="change"
      ><el-form-item label="原密码 / 临时密码" for="old-password"
        ><el-input
          id="old-password"
          v-model="oldPassword"
          type="password"
          show-password
          autocomplete="current-password" /></el-form-item
      ><el-form-item label="新密码" for="new-password"
        ><el-input
          id="new-password"
          v-model="newPassword"
          type="password"
          show-password
          autocomplete="new-password" /></el-form-item
      ><el-form-item label="确认新密码" for="confirm-password"
        ><el-input
          id="confirm-password"
          v-model="confirm"
          type="password"
          autocomplete="new-password" /></el-form-item
      ><el-button type="primary" native-type="submit" :loading="busy">确认修改</el-button
      ><el-button :disabled="busy" @click="logout">退出登录</el-button></el-form
    >
  </div>
</template>
