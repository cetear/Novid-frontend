<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../api'
import type { UserSnapshot, Role } from '@/shared/api/contracts/backend'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const users = ref<UserSnapshot[]>([]),
  page = ref(0),
  username = ref(''),
  temporary = ref(''),
  createdName = ref('')
const { busy, error, notice, run } = useAction()
async function load(n = page.value) {
  page.value = n
  users.value = []
  users.value = await adminApi.list(n)
}
onMounted(() => {
  void run(() => load())
})
function create() {
  void run(async () => {
    const result = await adminApi.create(username.value)
    temporary.value = result.temporaryPassword
    createdName.value = result.user.username
    username.value = ''
    await load()
  })
}
function update(id: number, enabled: boolean, role: Role) {
  void run(async () => {
    try {
      await adminApi.update(id, enabled, role)
      await load()
    } catch (e) {
      await load()
      throw e
    }
  })
}
function copy() {
  void run(async () => {
    await navigator.clipboard.writeText(temporary.value)
    notice.value = '临时密码已复制，请通过适当方式交给该用户。'
  })
}
</script>
<template>
  <PageHeader
    eyebrow="ACCOUNT ADMINISTRATION"
    title="用户管理"
    description="创建普通用户、调整启用状态和角色。最后有效管理员由后端保护。"
  /><Feedback :error="error" :notice="notice" />
  <div class="panel">
    <h2>创建普通用户</h2>
    <form class="toolbar" @submit.prevent="create">
      <el-input
        v-model="username"
        aria-label="新用户用户名"
        placeholder="3～64 个英文字母、数字、_.-"
        maxlength="64"
      /><el-button type="primary" native-type="submit" :loading="busy">创建用户</el-button>
    </form>
  </div>
  <section class="panel">
    <el-table :data="users" v-loading="busy"
      ><el-table-column prop="id" label="ID" width="80" /><el-table-column
        prop="username"
        label="用户名"
        min-width="160" /><el-table-column label="启用" width="100"
        ><template #default="{ row }"
          ><el-switch
            :model-value="row.enabled"
            :disabled="busy || !['USER', 'ADMIN'].includes(row.role)"
            :aria-label="'启用 ' + row.username"
            @change="update(row.id, Boolean($event), row.role)" /></template></el-table-column
      ><el-table-column label="角色" width="160"
        ><template #default="{ row }"
          ><el-select
            :model-value="row.role"
            :disabled="busy || !['USER', 'ADMIN'].includes(row.role)"
            :aria-label="'角色 ' + row.username"
            @change="update(row.id, row.enabled, $event)"
            ><el-option value="USER" label="USER" /><el-option
              value="ADMIN"
              label="ADMIN" /></el-select></template></el-table-column
      ><el-table-column label="首次改密" width="120"
        ><template #default="{ row }">{{
          row.passwordChangeRequired ? '需要' : '已完成'
        }}</template></el-table-column
      ><el-table-column prop="permissionVersion" label="权限版本" width="110" /></el-table
    ><PageStepper
      :page="page"
      :count="users.length"
      :busy="busy"
      @change="run(() => load($event))"
    />
  </section>
  <el-dialog
    :model-value="!!temporary"
    title="用户已创建 · 临时密码仅返回这一次"
    width="min(540px, 95vw)"
    @close="temporary = ''"
    ><p>用户：{{ createdName }}</p>
    <el-alert
      title="关闭后无法从列表找回该密码，请立即复制。首次登录将强制改密。"
      type="warning"
      :closable="false"
    />
    <pre class="temporary-password">{{ temporary }}</pre>
    <el-button type="primary" @click="copy">复制临时密码</el-button
    ><el-button @click="temporary = ''">已记录，关闭</el-button></el-dialog
  >
</template>
