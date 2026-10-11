<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  planIntent,
  logicalUnits,
  type ContentPlanSnapshot,
} from '@/shared/api/contracts/contentPlan'
import PageStepper from '@/shared/ui/PageStepper.vue'
const props = defineProps<{ snapshot: ContentPlanSnapshot }>()
const intent = computed(() => planIntent(props.snapshot.plan))
const page = ref(0),
  dutyPage = ref(0),
  knowledgePage = ref(0),
  slotPage = ref(0)
const rows = computed(() => {
  const plan = props.snapshot.plan
  return (
    plan.version === 2
      ? plan.units
      : (plan.compilation?.directory.chapters ?? plan.quiz?.chapters ?? [])
  ).slice(page.value * 20, (page.value + 1) * 20)
})
</script>
<template>
  <div class="content-plan">
    <h3>{{ intent?.title }}</h3>
    <p>{{ intent?.reason }}</p>
    <p v-if="intent?.requirements"><strong>备注要求：</strong>{{ intent.requirements }}</p>
    <p v-if="snapshot.plan.taskType === 'QUIZ_GENERATION'">
      计划 {{ snapshot.plan.counts.questions }} 题
    </p>
    <p v-else-if="snapshot.plan.taskType === 'KNOWLEDGE_COMPILATION'">
      计划 {{ snapshot.plan.counts.chapters }} 章 · {{ snapshot.plan.counts.sections }} 节
    </p>
    <p v-else>
      内容 {{ snapshot.plan.counts.contentSlides }} 页 + 来源
      {{ snapshot.plan.counts.sourceSlides }} 页 = 总计 {{ snapshot.plan.counts.totalSlides }} 页
    </p>
    <p>
      已完成内容单元 {{ snapshot.completedUnits }} / {{ logicalUnits(snapshot.plan) }} ·
      {{ snapshot.fullSourceRead ? '原文已完整读取' : '原文读取尚未确认完成' }}
    </p>
    <p v-if="snapshot.plan.version === 3">
      章节验收 {{ snapshot.completedChapters }} / {{ snapshot.totalChapters }} ·
      执行包拆分不增加内容单元数量
    </p>
    <p class="muted small">数量与完成度来自已接受的计划，不代表质量评分或剩余用时。</p>
    <details v-if="snapshot.plan.version === 3 && snapshot.plan.compilation" class="source-review">
      <summary>规范知识与小节职责</summary>
      <p>每个规范知识归属一个主要小节；上下文知识不重复计入主要覆盖。</p>
      <article
        v-for="section in snapshot.plan.compilation.sections.slice(
          dutyPage * 20,
          (dutyPage + 1) * 20,
        )"
        :key="section.id"
      >
        <h4>{{ section.title }}</h4>
        <p>{{ section.purpose }} · 所属章 {{ section.chapterId }}</p>
        <p>
          主要知识 {{ section.ownedKnowledgeIds.join('、') }} · 上下文
          {{ section.contextKnowledgeIds.join('、') || '无' }}
        </p>
      </article>
      <PageStepper :page="dutyPage" @change="dutyPage = $event" />
      <details>
        <summary>查看知识合并与条件</summary>
        <article
          v-for="item in snapshot.plan.compilation.knowledge.slice(
            knowledgePage * 20,
            (knowledgePage + 1) * 20,
          )"
          :key="item.id"
        >
          <p>{{ item.id }} · {{ item.relation }} · {{ item.summary }}</p>
          <p>
            来源事实 {{ item.sourceItemIds.join('、') }} · 条件
            {{ item.conditions.join('、') || '无' }}
          </p>
        </article>
        <PageStepper :page="knowledgePage" @change="knowledgePage = $event" />
      </details>
    </details>
    <details v-if="snapshot.plan.version === 3 && snapshot.plan.quiz" class="source-review">
      <summary>固定题位与主要考查目标</summary>
      <article
        v-for="slot in snapshot.plan.quiz.slots.slice(slotPage * 20, (slotPage + 1) * 20)"
        :key="slot.id"
      >
        <h4>{{ slot.id }} · {{ slot.type === 'SINGLE_CHOICE' ? '单选题' : '简答题' }}</h4>
        <p>
          主要章节 {{ slot.primaryChapterId }} · 目标 {{ slot.objectiveId }} · {{ slot.cognition }}
        </p>
        <p
          v-for="objective in snapshot.plan.quiz.objectives.filter(
            (o) => o.id === slot.objectiveId,
          )"
          :key="objective.id"
        >
          {{ objective.title }} · {{ objective.reason }}
        </p>
        <p>
          证据 {{ slot.itemIds.join('、') }} · 关联章节
          {{ slot.relatedChapterIds.join('、') || '无' }}
        </p>
      </article>
      <PageStepper :page="slotPage" @change="slotPage = $event" />
    </details>
    <details class="source-review">
      <summary>查看目录、配额与取舍</summary>
      <div v-for="row in rows" :key="row.id">
        <h4>{{ row.title }}</h4>
        <p v-if="'purpose' in row">{{ row.purpose }}</p>
        <p v-if="'itemIds' in row" class="muted small">事实引用 {{ row.itemIds.join('、') }}</p>
        <template v-if="snapshot.plan.version === 3 && snapshot.plan.quiz"
          ><p
            v-for="quota in snapshot.plan.quiz.quotas.filter((q) => q.chapterId === row.id)"
            :key="quota.chapterId"
          >
            主要题数 {{ quota.allocated }} · 最少 {{ quota.minimum }} · 容量 {{ quota.maximum }} ·
            {{ quota.reason }}
          </p></template
        >
      </div>
      <PageStepper :page="page" @change="page = $event" />
      <template v-if="snapshot.plan.version === 3 && snapshot.plan.quiz"
        ><p>覆盖策略：{{ snapshot.plan.quiz.intent.coveragePolicy }}</p>
        <p v-for="item in snapshot.plan.quiz.uncovered.slice(0, 20)" :key="item.id">
          未考查 {{ item.id }}：{{ item.reason }}
        </p></template
      >
      <template v-if="snapshot.plan.version === 2"
        ><p v-for="(item, i) in snapshot.plan.omissions.slice(0, 20)" :key="i">
          未采用 {{ item.itemIds.join('、') }}：{{ item.reason }}
        </p></template
      >
      <p class="muted small">
        预计调用 {{ snapshot.plan.estimatedTurns }} 轮 · 尝试
        {{ snapshot.plan.estimatedAttempts }} 次 · 输出
        {{ snapshot.plan.estimatedOutputBytes }} 字节
      </p>
      <p class="mono small">计划哈希 {{ snapshot.planHash }}</p>
    </details>
  </div>
</template>
<style scoped>
.content-plan {
  overflow-wrap: anywhere;
}
</style>
