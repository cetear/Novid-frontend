<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, FolderOpened, ArrowRight } from '@element-plus/icons-vue'
import { useAuth } from '@/features/auth'
import { knowledgeApi } from '../api'
import { useKnowledgeScope } from '../store'
import ScopePicker from '../components/ScopePicker.vue'
import { positiveId } from '@/shared/lib/validation'
import type { KnowledgeBaseSnapshot, KnowledgeStatistics } from '@/shared/api/contracts/backend'
import { useLoad } from '@/shared/lib/useLoad'
import { useAction } from '@/shared/lib/useAction'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const auth = useAuth(),
  scope = useKnowledgeScope(),
  router = useRouter(),
  page = ref(0)
const { data, loading, loadError, load } = useLoad<{
  bases: KnowledgeBaseSnapshot[]
  statistics: KnowledgeStatistics | null
}>()
const { busy, error, run } = useAction()
const creating = ref(false),
  name = ref(''),
  description = ref(''),
  knownId = ref('')
function refresh(n = page.value) {
  page.value = n
  const frozen = { ...scope.scope, knowledgeBaseIds: [...scope.scope.knowledgeBaseIds] }
  void load(async (signal) => {
    const results = await Promise.allSettled([
      knowledgeApi.bases(frozen, n, signal),
      frozen.ownerUserId === null ? knowledgeApi.statistics(frozen, signal) : Promise.resolve(null),
    ])
    const bases = results[0],
      stats = results[1]
    if (!bases || bases.status === 'rejected') throw bases?.reason
    if (!stats || stats.status === 'rejected') throw stats?.reason
    return { bases: bases.value, statistics: stats.value }
  })
}
watch(
  () => scope.revision,
  () => refresh(0),
  { immediate: true },
)
function create() {
  void run(async () => {
    const base = await knowledgeApi.createBase(name.value, description.value)
    creating.value = false
    name.value = ''
    description.value = ''
    await router.push('/knowledge-bases/' + base.id)
  })
}
function openKnown() {
  void run(async () => {
    await router.push('/knowledge-bases/' + positiveId(knownId.value))
  })
}
</script>
<template>
  <PageHeader
    eyebrow="YOUR KNOWLEDGE"
    title="知识，妥善收纳。"
    description="把资料放进知识库，让每次问答都有可靠出处。"
    ><el-button type="primary" :icon="Plus" @click="creating = true"
      >新建知识库</el-button
    ></PageHeader
  ><ScopePicker :admin="auth.user?.role === 'ADMIN'" /><Feedback :error="loadError || error" />
  <div v-if="data?.statistics" class="stats-grid">
    <div class="stat-card">
      <span>授权文档</span><strong>{{ data.statistics.documentCount }}</strong
      ><small>当前读取范围</small>
    </div>
    <div class="stat-card">
      <span>等待处理</span><strong>{{ data.statistics.receivedCount }}</strong
      ><small>已登记的资料</small>
    </div>
    <div class="stat-card">
      <span>已就绪</span><strong>{{ data.statistics.readyCount }}</strong
      ><small>已完成索引</small>
    </div>
  </div>
  <p v-if="scope.scope.ownerUserId !== null" class="muted small">
    所有者筛选下不展示统计：统计接口不支持该筛选。
  </p>
  <div class="section-title">
    <h2>知识库</h2>
    <el-button text :loading="loading" @click="refresh()">刷新</el-button>
  </div>
  <el-skeleton v-if="loading" :rows="4" animated />
  <div v-else-if="data?.bases.length" class="bases-grid">
    <RouterLink
      v-for="base in data.bases"
      :key="base.id"
      :to="'/knowledge-bases/' + base.id"
      class="base-card"
      ><div class="base-card-top">
        <span class="folder-icon"
          ><el-icon><FolderOpened /></el-icon></span
        ><span class="mono muted">#{{ base.id }}</span>
      </div>
      <h3>{{ base.name }}</h3>
      <p>{{ base.description || '尚未填写描述' }}</p>
      <div class="base-card-bottom">
        <span>{{
          base.ownerUserId === auth.user?.id ? '我的知识库' : '授权只读 · 用户 #' + base.ownerUserId
        }}</span
        ><el-icon><ArrowRight /></el-icon></div
    ></RouterLink>
  </div>
  <el-empty v-else-if="!loadError" description="本页暂无知识库；可新建或继续翻页。" /><PageStepper
    :page="page"
    :count="data?.bases.length"
    :busy="loading"
    @change="refresh"
  />
  <section class="recovery-panel">
    <div>
      <strong>找回已知知识库</strong>
      <p class="muted small">禁用库不会出现在列表中，可通过已知 ID 打开并恢复。</p>
    </div>
    <div class="toolbar">
      <el-input v-model="knownId" placeholder="知识库 ID" aria-label="已知知识库 ID" /><el-button
        @click="openKnown"
        >打开</el-button
      >
    </div>
    <div v-if="scope.disabledIds.length" class="known-links">
      <RouterLink v-for="id in scope.disabledIds" :key="id" :to="'/knowledge-bases/' + id"
        >本次禁用 #{{ id }}</RouterLink
      >
    </div>
  </section>
  <el-dialog v-model="creating" title="新建知识库" width="min(520px, 94vw)"
    ><Feedback :error="error" /><el-form label-position="top" @submit.prevent="create"
      ><el-form-item label="名称" for="base-name"
        ><el-input id="base-name" v-model="name" maxlength="200" /></el-form-item
      ><el-form-item label="描述" for="base-description"
        ><el-input
          id="base-description"
          v-model="description"
          type="textarea"
          :rows="4"
          maxlength="2000" /></el-form-item
      ><el-button native-type="submit" type="primary" :loading="busy"
        >创建知识库</el-button
      ></el-form
    ></el-dialog
  >
</template>
