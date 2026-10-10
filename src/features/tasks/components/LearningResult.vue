<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LearningResult, LearningCitation } from '@/shared/api/contracts/learning'
import { knowledgeApi } from '@/features/knowledge'
import { validRange } from '@/shared/lib/validation'
import { useLoad } from '@/shared/lib/useLoad'
import { isAbort } from '@/shared/api/errors'
import MarkdownView from '@/shared/ui/MarkdownView.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const props = defineProps<{ result: LearningResult }>()
const emit = defineEmits<{ invalidated: [error: unknown] }>()
const citation = ref<LearningCitation | null>(null)
const { data: excerpt, loading, loadError, load } = useLoad<string>()
const groups = computed(
  () =>
    new Map(
      props.result.outline?.chapters.flatMap((c) => c.groups.map((g) => [g.id, g] as const)) ?? [],
    ),
)
function citations(itemIds: string[]) {
  return props.result.citations.filter((c) => itemIds.includes(c.itemId))
}
function locate(value: LearningCitation) {
  citation.value = value
  void load(async (signal) => {
    try {
      const current = await knowledgeApi.document(value.source.documentId, signal)
      if (
        current.document.documentVersion !== value.source.documentVersion ||
        current.document.activeProcessingRevision !== value.source.processingRevision
      )
        throw new Error('来源版本或处理代次已变化，请重新核验学习结果。')
      // Learning quote offsets are absolute UTF-16 positions in the full source.
      if (
        !validRange(current.text, value.quoteStartOffset, value.quoteEndOffset) ||
        current.text.slice(value.quoteStartOffset, value.quoteEndOffset) !== value.quote
      )
        throw new Error('引文与当前原文不一致，请重新核验学习结果。')
      return current.text.slice(value.quoteStartOffset, value.quoteEndOffset)
    } catch (e) {
      if (!isAbort(e)) emit('invalidated', e)
      throw e
    }
  })
}
</script>
<template>
  <section class="panel learning-result">
    <span class="eyebrow">PRIVATE LEARNING RESULT</span>
    <h2>{{ result.title }}</h2>
    <p>
      计划数量：{{ result.contentPlan.counts.questions }} 题 ·
      {{ result.contentPlan.counts.chapters }} 章 · {{ result.contentPlan.counts.sections }} 节
    </p>
    <p>{{ result.contentPlan.intent.reason }}</p>
    <el-alert
      :title="
        result.qualityStatus === 'MODEL_REVIEW_PASSED_PENDING_HUMAN'
          ? '模型质检已通过，内容质量仍待人工判断。'
          : '质量状态：' + result.qualityStatus
      "
      type="warning"
      :closable="false"
    />
    <p class="muted">
      {{
        result.fullSourceRead
          ? '已完整读取选中文档；不代表穷尽全部知识点。'
          : '未确认完整读取选中文档。'
      }}
    </p>
    <template v-if="result.quiz">
      <h3>{{ result.quiz.title }}</h3>
      <article
        v-for="(question, index) in result.quiz.questions"
        :key="question.id"
        class="learning-question"
      >
        <h3>{{ index + 1 }}. {{ question.stem }}</h3>
        <p class="muted small">{{ question.type === 'SINGLE_CHOICE' ? '单选题' : '简答题' }}</p>
        <ol v-if="question.options.length" type="A">
          <li v-for="(option, i) in question.options" :key="i">{{ option }}</li>
        </ol>
        <details class="source-review">
          <summary>查看答案与解析</summary>
          <p><strong>答案：</strong>{{ question.answer }}</p>
          <MarkdownView :text="question.explanation" />
        </details>
        <div class="toolbar">
          <el-button
            v-for="(source, i) in citations(question.itemIds)"
            :key="i"
            plain
            @click="locate(source)"
            >引用 · {{ source.source.title }}</el-button
          >
        </div>
      </article>
    </template>
    <template v-if="result.outline">
      <nav aria-label="整编目录" class="source-review">
        <h3>{{ result.outline.title }} · 目录</h3>
        <ol>
          <li v-for="chapter in result.outline.chapters" :key="chapter.id">
            <strong>{{ chapter.title }}</strong>
            <p v-for="group in chapter.groups" :key="group.id">
              {{ group.heading
              }}<span v-if="group.relation" class="muted"> · {{ group.relation }}</span>
            </p>
          </li>
        </ol>
      </nav>
      <article v-for="chapter in result.chapters" :key="chapter.id" class="learning-chapter">
        <h3>{{ chapter.title }}</h3>
        <section
          v-for="section in chapter.sections"
          :key="section.groupId"
          class="learning-section"
        >
          <h4 v-if="groups.get(section.groupId)">{{ groups.get(section.groupId)?.heading }}</h4>
          <MarkdownView :text="section.body" />
          <div class="toolbar">
            <el-button
              v-for="(source, i) in citations(section.itemIds)"
              :key="i"
              plain
              @click="locate(source)"
              >引用 · {{ source.source.title }}</el-button
            >
          </div>
        </section>
      </article>
    </template>
    <details class="source-review">
      <summary>全部引用（{{ result.citations.length }}）</summary>
      <article v-for="(source, i) in result.citations" :key="i" class="structure-row">
        <strong>{{ source.source.title }} · {{ source.itemId }}</strong>
        <p class="preserve-text">{{ source.quote }}</p>
        <el-button @click="locate(source)">核验并定位原文</el-button>
      </article>
    </details>
  </section>
  <el-drawer
    :model-value="!!citation"
    title="学习引用与原文"
    size="min(680px, 100vw)"
    @close="citation = null"
  >
    <Feedback :error="loadError" />
    <p v-if="loading" class="muted">正在核验来源版本和处理代次…</p>
    <template v-if="citation && excerpt !== null">
      <h2>{{ citation.source.title }}</h2>
      <p class="muted">
        文档 #{{ citation.source.documentId }} · v{{ citation.source.documentVersion }} · 处理代次
        {{ citation.source.processingRevision }}
      </p>
      <p class="mono small">
        原文 UTF-16 范围 [{{ citation.quoteStartOffset }}, {{ citation.quoteEndOffset }})
      </p>
      <pre class="source-text">{{ excerpt }}</pre>
    </template>
  </el-drawer>
</template>
<style scoped>
.learning-result {
  overflow-wrap: anywhere;
}
.learning-question,
.learning-chapter {
  padding-block: 20px;
  border-bottom: 1px solid var(--color-border);
}
.learning-section {
  margin-block: 20px;
}
.learning-question li {
  margin-block: 8px;
}
.learning-result .toolbar {
  flex-wrap: wrap;
}
.learning-result .toolbar .el-button {
  max-width: 100%;
  height: auto;
  min-height: 36px;
  white-space: normal;
}
</style>
