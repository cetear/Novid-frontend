<script setup lang="ts">
import { ref, watch } from 'vue'
import { tasksApi } from '../api'
import { ApiError } from '@/shared/api/errors'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import { useAction } from '@/shared/lib/useAction'
import type { ReadPlan } from '@/shared/api/contracts/workflow'
import type { z } from 'zod'
import type { packageStatusSchema } from '@/shared/api/contracts/contentPlan'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const props = defineProps<{ taskId: number }>()
const emit = defineEmits<{ invalidated: [error: unknown] }>()
const requests = usePageSignal()
const { busy, error, run } = useAction()
const read = ref<ReadPlan | null>(null),
  packages = ref<z.infer<typeof packageStatusSchema>[]>([]),
  page = ref(0),
  fragmentPage = ref(0),
  cardPage = ref(0),
  checked = ref(false)
watch(
  () => props.taskId,
  () => {
    read.value = null
    packages.value = []
    page.value = 0
    checked.value = false
  },
)
function load(next = page.value) {
  void run(async () => {
    read.value = null
    packages.value = []
    try {
      const [r, p] = await Promise.all([
        tasksApi.readPlan(props.taskId, requests.signal),
        tasksApi.workPackages(props.taskId, next, requests.signal),
      ])
      read.value = r
      packages.value = p
      page.value = next
      checked.value = true
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) emit('invalidated', e)
      throw e
    }
  })
}
</script>
<template>
  <section class="panel">
    <h3>阅读与执行诊断</h3>
    <el-button :loading="busy" @click="load()">核验阅读与工作包</el-button
    ><Feedback :error="error" />
    <p v-if="checked && !read">阅读计划尚未冻结（204）。</p>
    <template v-if="read"
      ><p>
        读取片段 {{ read.completedFragments }} / {{ read.plan.fragments.length }} · 阅读包
        {{ read.completedPacks }} / {{ read.plan.packs.length }} ·
        {{ read.fullSourceRead ? '完整读取已确认' : '读取尚未完成' }}
      </p>
      <details>
        <summary>查看冻结的来源范围</summary>
        <p>正文位置采用 UTF-16；背景上下文不重复计入覆盖。</p>
        <p
          v-for="f in read.plan.fragments.slice(fragmentPage * 20, (fragmentPage + 1) * 20)"
          :key="f.source.id"
        >
          {{ f.headingPath }} · 文档 #{{ f.source.documentId }} v{{ f.source.documentVersion }} ·
          代次 {{ f.source.processingRevision }} · [{{ f.source.startOffset }},
          {{ f.source.endOffset }}) · {{ f.blockType }} · {{ f.splitReason }}
        </p>
        <PageStepper :page="fragmentPage" @change="fragmentPage = $event" />
      </details>
      <details>
        <summary>主题卡 {{ read.topicCards.length }} 张</summary>
        <article
          v-for="card in read.topicCards.slice(cardPage * 20, (cardPage + 1) * 20)"
          :key="card.id"
        >
          <h4>{{ card.topic.title }}</h4>
          <p>{{ card.topic.summary }}</p>
          <p>{{ card.headingPath }} · {{ card.factCount }} 个事实 · {{ card.sourceBytes }} 字节</p>
          <p>
            关键词 {{ card.topic.keywords.join('、') }} · 实体
            {{ card.topic.entities.join('、') }} · 角色 {{ card.topic.contentRole }}
          </p>
          <p>
            条件 {{ card.topic.conditions.join('、') }} · 关系 {{ card.topic.relations.join('、') }}
          </p>
          <p class="muted small">
            {{ card.id }} · 事实 {{ card.topic.itemIds.join('、') }} · 依赖
            {{ card.topic.dependencyItemIds.join('、') }}
          </p>
        </article>
        <PageStepper :page="cardPage" @change="cardPage = $event" /></details
    ></template>
    <details v-for="p in packages" :key="p.workPackage.id">
      <summary>
        {{ p.workPackage.id }} · {{ p.status }} · 已验收职责 {{ p.acceptedParts }} /
        {{ p.parts.length }}
      </summary>
      <p>
        父包 {{ p.workPackage.parentId || '无' }} · 深度 {{ p.workPackage.depth }} · 尝试
        {{ p.attempts }} · 输入 {{ p.workPackage.inputBytes }} 字节 · 输出
        {{ p.workPackage.outputBytes }} 字节
      </p>
      <p>
        依赖：{{ p.workPackage.dependencies.join('、') || '无' }} · 子包：{{
          p.children.join('、') || '无'
        }}
      </p>
      <p v-if="p.errorCode">
        {{ p.errorCode === 'WORKFLOW_INTERRUPTED' ? '被中断，等待续跑' : p.errorCode }}
      </p>
      <p v-for="part in p.parts" :key="part.id">
        {{ part.id }} → {{ part.logicalId }} · {{ part.purpose }} · 证据
        {{ part.itemIds.join('、') }}
      </p>
    </details>
    <PageStepper v-if="checked" :page="page" :busy="busy" :count="packages.length" @change="load" />
    <p class="muted small">替换包由子包继续执行，包数不代表题数或章节数。查询不会触发重跑。</p>
  </section>
</template>

<style scoped>
section {
  overflow-wrap: anywhere;
}
</style>
