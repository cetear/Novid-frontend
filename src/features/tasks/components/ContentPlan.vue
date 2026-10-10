<script setup lang="ts">
import type { ContentPlanSnapshot } from '@/shared/api/contracts/contentPlan'
defineProps<{ snapshot: ContentPlanSnapshot }>()
</script>
<template>
  <div class="content-plan">
    <h3>{{ snapshot.plan.intent.title }}</h3>
    <p>{{ snapshot.plan.intent.reason }}</p>
    <p v-if="snapshot.plan.intent.requirements">
      <strong>备注要求：</strong>{{ snapshot.plan.intent.requirements }}
    </p>
    <p v-if="snapshot.plan.intent.requestedUnits">
      <strong>数量要求：</strong>{{ snapshot.plan.intent.requestedUnits }}
    </p>
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
      已完成内容单元 {{ snapshot.completedUnits }} / {{ snapshot.plan.units.length }} ·
      {{ snapshot.fullSourceRead ? '原文已完整读取' : '原文读取尚未确认完成' }}
    </p>
    <p class="muted small">数量与完成度来自已接受的计划，不代表质量评分或剩余用时。</p>
    <details class="source-review">
      <summary>查看主题、内容单元与取舍</summary>
      <div v-for="theme in snapshot.plan.intent.themes" :key="theme.id">
        <h4>{{ theme.title }}</h4>
        <p>{{ theme.purpose }}</p>
      </div>
      <div v-for="unit in snapshot.plan.units" :key="unit.id" class="source-review">
        <strong>{{ unit.title }}</strong>
        <p>{{ unit.purpose }}</p>
        <p v-if="unit.relation">{{ unit.relation }}</p>
        <p class="muted small">{{ unit.kind }} · 事实引用 {{ unit.itemIds.join('、') || '无' }}</p>
      </div>
      <p v-for="(omission, i) in snapshot.plan.omissions" :key="i">
        未采用 {{ omission.itemIds.join('、') }}：{{ omission.reason }}
      </p>
      <p class="muted small">
        预计调用 {{ snapshot.plan.estimatedTurns }} 轮 · 尝试
        {{ snapshot.plan.estimatedAttempts }} 次 · 输出
        {{ snapshot.plan.estimatedOutputBytes }} 字节
      </p>
      <p class="muted small">执行节点：{{ snapshot.plan.requiredNodes.join('、') }}</p>
      <p class="mono small" style="overflow-wrap: anywhere">计划哈希 {{ snapshot.planHash }}</p>
    </details>
  </div>
</template>
<style scoped>
.content-plan {
  overflow-wrap: anywhere;
}
</style>
