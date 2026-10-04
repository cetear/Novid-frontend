<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TraceGraph, TraceSpan } from '@/shared/api/contracts/backend'
import { nodeRows, duration, knownUsage } from '../model'
import { dateTime } from '@/shared/lib/format'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const props = defineProps<{ graph: TraceGraph }>()
const selectedId = ref('')
const rows = computed(() => nodeRows(props.graph.nodes))
const selected = computed(() => props.graph.nodes.find((node) => node.spanId === selectedId.value))
const usage = computed(() => knownUsage(props.graph))
const positions = computed(
  () =>
    new Map(
      rows.value.map(({ node, depth }, index) => [
        node.spanId,
        { x: 30 + Math.min(depth, 4) * 170, y: 35 + index * 65 },
      ]),
    ),
)
const edges = computed(() =>
  props.graph.edges.flatMap((edge) => {
    const from = positions.value.get(edge.from),
      to = positions.value.get(edge.to)
    if (!from || !to) return []
    const x = Math.min(1020, Math.max(from.x, to.x) + 165)
    return [
      {
        ...edge,
        path: `M ${from.x + 150} ${from.y} C ${x} ${from.y}, ${x} ${to.y}, ${to.x + 150} ${to.y}`,
      },
    ]
  }),
)
const clock = computed(() => {
  const starts = props.graph.nodes.map((node) => Date.parse(node.startedAt))
  const ends = props.graph.nodes.map((node) => Date.parse(node.endedAt || node.startedAt))
  const start = starts.length ? Math.min(...starts) : 0,
    end = ends.length ? Math.max(...ends) : 0
  return { start, span: Math.max(1, end - start) }
})
function timeline(node: TraceSpan) {
  const offset = ((Date.parse(node.startedAt) - clock.value.start) / clock.value.span) * 100
  const width = ((duration(node) ?? 0) / clock.value.span) * 100
  return { left: `${offset}%`, width: `${Math.max(0.5, width)}%` }
}
</script>
<template>
  <section class="panel">
    <h3>实际调用与依赖</h3>
    <p class="muted small">
      实线：嵌套调用；虚线：执行依赖。节点按登记序号排列，序号不代表并行执行顺序。点击节点查看事实。
    </p>
    <p v-if="graph.incomplete" class="inline-error">
      运行图不完整：可能仍在执行、等待写入、记录缺失或被截断。不能据此认定全部步骤完成。
    </p>
    <p v-if="graph.missingNodeIds.length" class="mono small">
      缺失节点：{{ graph.missingNodeIds.join('、') }}
    </p>
    <p v-if="!rows.length" class="muted">暂无节点记录，请稍后手动刷新；旧摘要可能没有执行节点。</p>
    <div v-else class="run-graph-scroll">
      <svg
        class="run-graph"
        width="1100"
        :height="Math.max(100, rows.length * 65 + 30)"
        role="img"
        aria-label="实际运行调用与依赖图"
      >
        <defs>
          <marker
            id="run-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <path
          v-for="(edge, index) in edges"
          :key="index"
          :d="edge.path"
          fill="none"
          :stroke="edge.kind === 'DEPENDENCY' ? '#a4772e' : '#7c9691'"
          :stroke-dasharray="edge.kind === 'DEPENDENCY' ? '5 4' : undefined"
          marker-end="url(#run-arrow)"
        >
          <title>{{ edge.kind }}：{{ edge.from }} → {{ edge.to }}</title>
        </path>
        <g
          v-for="{ node } in rows"
          :key="node.spanId"
          :transform="`translate(${positions.get(node.spanId)!.x}, ${positions.get(node.spanId)!.y - 20})`"
          tabindex="0"
          role="button"
          :aria-label="'查看节点 ' + node.name"
          @click="selectedId = node.spanId"
          @keydown.enter="selectedId = node.spanId"
          @keydown.space.prevent="selectedId = node.spanId"
        >
          <rect
            width="150"
            height="40"
            rx="8"
            :fill="selectedId === node.spanId ? '#d5e9e1' : '#f3f6f3'"
            stroke="#7c9691"
          />
          <text x="8" y="16" font-size="11">{{ node.name.slice(0, 20) }}</text>
          <text x="8" y="31" font-size="10">{{ node.type }} · {{ node.status }}</text>
          <title>{{ node.spanId }} · {{ node.name }}</title>
        </g>
      </svg>
    </div>
    <ul class="run-node-tree">
      <li
        v-for="{ node, depth, brokenParent } in rows"
        :key="node.spanId"
        :style="{ paddingLeft: Math.min(depth, 4) * 16 + 'px' }"
      >
        <button class="node-link" @click="selectedId = node.spanId">{{ node.name }}</button> ·
        {{ node.status }} <span v-if="brokenParent" class="muted small">（父节点缺失或循环）</span>
      </li>
    </ul>
  </section>
  <section class="panel">
    <h3>实际时间线</h3>
    <p class="muted small">未结束节点仅标记开始位置，耗时保持未知。模型首次 Token 时间未知。</p>
    <div v-for="{ node } in rows" :key="node.spanId" class="timeline-row">
      <button class="node-link" @click="selectedId = node.spanId">{{ node.name }}</button>
      <div class="timeline-track">
        <span :class="{ unfinished: !node.endedAt }" :style="timeline(node)" />
      </div>
      <span class="small">{{ duration(node) === null ? '未知' : duration(node) + ' ms' }}</span>
    </div>
  </section>
  <section v-if="selected" class="panel">
    <h3>{{ selected.name }}</h3>
    <StatusBadge :status="selected.status" />
    <p class="mono small">
      {{ selected.spanId }} · 父节点 {{ selected.parentSpanId ?? '无' }} · 登记序号
      {{ selected.sequence }}
    </p>
    <p>
      角色 {{ selected.agentId ?? '无' }} · 步骤 {{ selected.stepId ?? '无' }} · 模型
      {{ selected.modelId ?? '无' }} · 尝试 {{ selected.attempt ?? '未知' }}
    </p>
    <p>
      开始 {{ dateTime(selected.startedAt) }} · 结束 {{ dateTime(selected.endedAt) }} · 耗时
      {{ duration(selected) ?? '未知' }} ms
    </p>
    <p>
      输入 {{ selected.inputTokens ?? '未知' }} · 输出 {{ selected.outputTokens ?? '未知' }} ·
      用量来源 {{ selected.usageSource ?? '未知' }}
    </p>
    <p v-if="selected.routeReason">路由原因：{{ selected.routeReason }}</p>
    <p v-if="selected.toolCallHash" class="mono small">工具关联哈希 {{ selected.toolCallHash }}</p>
    <p v-if="selected.errorCode" class="inline-error">{{ selected.errorCode }}</p>
  </section>
  <section class="panel">
    <h3>用量与费用</h3>
    <p>
      已知提供方用量：输入 {{ usage.input }} / 输出 {{ usage.output }} · 未知用量节点
      {{ usage.unknown }} · 模拟节点 {{ usage.simulated }}
    </p>
    <p class="muted small">
      只加总 MODEL / EMBEDDING 叶节点的已知 PROVIDER
      用量，父节点不重复计数。未知部分没有计入，费用状态 {{ graph.costStatus }}；不换算金额。
    </p>
  </section>
</template>
