<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { memoriesApi } from '../api'
import type { MemorySnapshot } from '@/shared/api/contracts/backend'
import { ApiError } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const memories = ref<MemorySnapshot[]>([]),
  draft = ref(''),
  selected = ref<MemorySnapshot | null>(null),
  editText = ref('')
const { busy, error, notice, run } = useAction()
async function load() {
  try {
    memories.value = await memoriesApi.list()
  } catch (e) {
    memories.value = []
    selected.value = null
    editText.value = ''
    throw e
  }
}
function refresh() {
  void run(load)
}
onMounted(refresh)
function create() {
  void run(async () => {
    await memoriesApi.create(draft.value)
    draft.value = ''
    await load()
  })
}
function edit(memory: MemorySnapshot) {
  selected.value = { ...memory }
  editText.value = memory.content
}
async function conflict(e: unknown) {
  if (e instanceof ApiError && e.status === 403) {
    await load()
    notice.value =
      '该操作被拒绝，可能是版本变化。已重新读取本人列表，请核对后重新选择编辑；草稿未自动覆盖。'
  }
}
function save() {
  void run(async () => {
    if (!selected.value) return
    try {
      await memoriesApi.update(selected.value, editText.value)
      selected.value = null
      editText.value = ''
      await load()
    } catch (e) {
      await conflict(e)
      throw e
    }
  })
}
function remove(memory: MemorySnapshot) {
  void run(async () => {
    try {
      await memoriesApi.delete(memory)
      await load()
    } catch (e) {
      await conflict(e)
      throw e
    }
  })
}
</script>
<template>
  <PageHeader
    eyebrow="PERSONAL PREFERENCES"
    title="让表达，更贴合你。"
    description="显式保存你的偏好，最多 100 条。模型不会在这里自动写入推测。"
    ><el-button :loading="busy" @click="refresh">刷新</el-button></PageHeader
  ><Feedback :error="error" :notice="notice" />
  <div class="memories-grid">
    <section class="panel memory-create">
      <h2>添加一条偏好</h2>
      <el-form label-position="top" @submit.prevent="create"
        ><el-form-item label="偏好内容" for="memory-content"
          ><el-input
            id="memory-content"
            v-model="draft"
            type="textarea"
            :rows="5"
            maxlength="2000"
            show-word-limit
            placeholder="例如：回答先给结论，再展开解释。" /></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy" :disabled="!draft.trim()"
          >保存偏好</el-button
        ></el-form
      >
    </section>
    <section class="memory-list">
      <el-empty
        v-if="!memories.length && !busy"
        description="暂无偏好，从一条具体的表达习惯开始。"
      />
      <article v-for="memory in memories" :key="memory.id" class="panel memory-card">
        <span class="eyebrow">PREFERENCE #{{ memory.id }} · V{{ memory.version }}</span>
        <p>{{ memory.content }}</p>
        <div class="toolbar">
          <el-button text :disabled="busy" @click="edit(memory)">更正</el-button
          ><el-popconfirm title="删除这条偏好？" @confirm="remove(memory)"
            ><template #reference
              ><el-button text type="danger" :disabled="busy">删除</el-button></template
            ></el-popconfirm
          >
        </div>
      </article>
    </section>
  </div>
  <el-dialog
    :model-value="!!selected"
    title="更正偏好"
    width="min(560px, 95vw)"
    @close="selected = null"
    ><Feedback :error="error" :notice="notice" />
    <p class="muted small">
      编辑版本 v{{ selected?.version }}。发生版本冲突时，请核对列表中的新版本。
    </p>
    <el-input v-model="editText" type="textarea" :rows="6" maxlength="2000" /><template #footer
      ><el-button @click="selected = null">取消</el-button
      ><el-button type="primary" :loading="busy" @click="save">保存更正</el-button></template
    ></el-dialog
  >
</template>
