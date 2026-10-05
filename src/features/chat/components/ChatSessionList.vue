<script setup lang="ts">
import { ChatDotRound, Plus, Refresh, Delete } from '@element-plus/icons-vue'
import { computed } from 'vue'
import type { useSessions } from '../useSessions'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const props = defineProps<{ sessions: ReturnType<typeof useSessions>; sending: boolean }>()
const emit = defineEmits<{
  open: [id: number]
  create: []
  single: []
  refresh: []
  remove: []
  title: [value: string]
}>()
const title = computed({
  get: () => props.sessions.title.value,
  set: (value) => emit('title', value),
})
function date(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  )
}
</script>
<template>
  <div class="conversation-list session-panel">
    <div class="conversation-list-heading">
      <h2>会话</h2>
      <el-button
        text
        :icon="Refresh"
        aria-label="刷新会话列表"
        :disabled="sending || sessions.busy.value"
        @click="sessions.refreshList()"
      />
    </div>
    <form class="conversation-create" @submit.prevent="$emit('create')">
      <el-input
        v-model="title"
        maxlength="200"
        aria-label="新会话标题"
        placeholder="新会话标题"
        :disabled="sending || sessions.busy.value"
      />
      <el-button
        type="primary"
        :icon="Plus"
        native-type="submit"
        :disabled="sending || sessions.busy.value"
        >新建会话</el-button
      >
    </form>
    <button
      class="conversation-item temporary-conversation"
      :class="{ 'is-active': !sessions.active.value }"
      :aria-current="!sessions.active.value ? 'true' : undefined"
      :disabled="sending || sessions.busy.value"
      @click="$emit('single')"
    >
      <el-icon><ChatDotRound /></el-icon
      ><span><strong>单轮问答</strong><small>临时提问，不保存为会话</small></span>
    </button>
    <Feedback :error="sessions.error.value" />
    <p class="conversation-list-label">
      本人会话 <span>{{ sessions.list.value.length }}</span>
    </p>
    <nav class="session-links" aria-label="会话列表" :aria-busy="sessions.busy.value">
      <button
        v-for="session in sessions.list.value"
        :key="session.id"
        class="conversation-item"
        :class="{ 'is-active': session.id === sessions.active.value?.id }"
        :aria-current="session.id === sessions.active.value?.id ? 'true' : undefined"
        :disabled="sending || sessions.busy.value"
        @click="$emit('open', session.id)"
      >
        <el-icon><ChatDotRound /></el-icon
        ><span
          ><strong>{{ session.title || '未命名会话' }}</strong
          ><small>{{ date(session.updatedAt) }} · #{{ session.id }}</small></span
        >
      </button>
      <p v-if="!sessions.list.value.length" class="conversation-list-empty">
        {{ sessions.busy.value ? '正在读取会话…' : '还没有会话。从上方新建，保存并继续你的讨论。' }}
      </p>
    </nav>
    <PageStepper
      :page="sessions.page.value"
      :count="sessions.list.value.length"
      :busy="sending || sessions.busy.value"
      @change="sessions.refreshList"
    />
    <div v-if="sessions.active.value" class="conversation-management">
      <p>会话 #{{ sessions.active.value.id }} · 版本 {{ sessions.active.value.version }}</p>
      <el-button
        text
        :icon="Refresh"
        :disabled="sending || sessions.busy.value"
        @click="$emit('refresh')"
        >核对服务端历史</el-button
      >
      <el-popconfirm title="删除该会话及历史？" @confirm="$emit('remove')"
        ><template #reference
          ><el-button text type="danger" :icon="Delete" :disabled="sending || sessions.busy.value"
            >删除会话</el-button
          ></template
        ></el-popconfirm
      >
    </div>
    <p class="conversation-list-note">会话保存完整历史，模型使用有限上下文。</p>
  </div>
</template>
