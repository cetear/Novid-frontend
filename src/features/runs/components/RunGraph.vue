<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import NodePayload from './NodePayload.vue'
import type { TraceGraph, TraceSpan } from '@/shared/api/contracts/backend'
import { nodeRows, nodeHierarchy, duration, knownUsage, timelineGroups } from '../model'
import { dateTime, formatDuration } from '@/shared/lib/format'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const props = defineProps<{ graph: TraceGraph }>()
const selectedId = ref('')
const timelineId = useId()
const expandedCategories = ref(new Set<string>())
const expandedNodes = ref(new Set<string>())
const hierarchy = computed(() => nodeHierarchy(props.graph.nodes))
const rows = computed(() => {
  const visible = new Set<string>()
  const pending = [...hierarchy.value.roots]
  while (pending.length) {
    const id = pending.pop()!
    if (visible.has(id)) continue
    visible.add(id)
    if (expandedNodes.value.has(id)) pending.push(...(hierarchy.value.children.get(id) ?? []))
  }
  return nodeRows(props.graph.nodes).filter(({ node }) => visible.has(node.spanId))
})
watch(
  () => props.graph.run.traceId,
  () => {
    expandedNodes.value.clear()
    expandedCategories.value.clear()
    selectedId.value = ''
  },
)
const groups = computed(() => timelineGroups(props.graph.nodes))
const selected = computed(() => props.graph.nodes.find((node) => node.spanId === selectedId.value))
const usage = computed(() => knownUsage(props.graph))
const positions = computed(
  () =>
    new Map(
      rows.value.map(({ node, depth }, index) => [
        node.spanId,
        { x: 30 + Math.min(depth, 4) * 210, y: 35 + index * 65 },
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
function toggleGroup(category: string) {
  if (expandedCategories.value.has(category)) expandedCategories.value.delete(category)
  else expandedCategories.value.add(category)
}
function toggleNode(id: string) {
  if (!expandedNodes.value.has(id)) {
    expandedNodes.value.add(id)
    return
  }
  const pending = [id]
  const seen = new Set<string>()
  while (pending.length) {
    const descendant = pending.pop()!
    if (seen.has(descendant)) continue
    seen.add(descendant)
    expandedNodes.value.delete(descendant)
    pending.push(...(hierarchy.value.children.get(descendant) ?? []))
  }
}
</script>
<template>
  <section class="panel">
    <h3>实际调用与依赖</h3>
    <p class="muted small">
      实线：嵌套调用；虚线：执行依赖。节点按登记序号排列，序号不代表并行执行顺序。点击节点查看输入、输出和耗时。
      默认仅显示最顶层节点，点击旁边的加号展开一层子节点，点击减号收起全部后代节点。
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
        role="group"
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
        >
          <g
            class="run-graph-node"
            tabindex="0"
            role="button"
            :aria-label="'查看节点 ' + node.name"
            :aria-pressed="selectedId === node.spanId"
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
          <g
            v-if="hierarchy.children.has(node.spanId)"
            class="run-graph-toggle"
            transform="translate(154, -2)"
            tabindex="0"
            role="button"
            :aria-label="`${expandedNodes.has(node.spanId) ? '收起' : '展开'} ${node.name}的子节点`"
            :aria-expanded="expandedNodes.has(node.spanId)"
            @click.stop="toggleNode(node.spanId)"
            @keydown.enter.stop.prevent="toggleNode(node.spanId)"
            @keydown.space.stop.prevent="toggleNode(node.spanId)"
          >
            <rect class="toggle-hit-area" width="44" height="44" rx="8" />
            <rect class="toggle-icon" x="10" y="10" width="24" height="24" rx="5" />
            <path d="M 16 22 H 28" />
            <path v-if="!expandedNodes.has(node.spanId)" d="M 22 16 V 28" />
          </g>
        </g>
      </svg>
    </div>
  </section>
  <section class="panel">
    <h3>实际时间线</h3>
    <p class="muted small">
      按节点类别累加已知耗时，点击类别展开各节点明细。并行或嵌套节点的耗时分别计入，不等于运行总时长。
      未结束节点仅标记开始位置，耗时保持未知。模型首次 Token 时间未知。
    </p>
    <p v-if="!groups.length" class="muted">暂无时间线记录。</p>
    <div v-for="(group, index) in groups" :key="group.category" class="timeline-group">
      <button
        type="button"
        class="timeline-group-toggle"
        :aria-expanded="expandedCategories.has(group.category)"
        :aria-controls="`${timelineId}-${index}`"
        @click="toggleGroup(group.category)"
      >
        <span class="timeline-group-label">
          <svg
            class="timeline-chevron"
            :class="{ expanded: expandedCategories.has(group.category) }"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
          <strong>{{ group.category }}</strong>
          <span class="muted small">{{ group.nodes.length }} 个节点</span>
        </span>
        <span class="timeline-group-duration small">
          {{ group.unknownCount ? '已知耗时' : '总耗时' }}
          {{ formatDuration(group.totalDuration) }}
          <span v-if="group.unknownCount" class="muted">
            · {{ group.unknownCount }} 个耗时未知
          </span>
        </span>
      </button>
      <div :id="`${timelineId}-${index}`" :hidden="!expandedCategories.has(group.category)">
        <div v-if="expandedCategories.has(group.category)" class="timeline-group-details">
          <div v-for="node in group.nodes" :key="node.spanId" class="timeline-row">
            <button class="node-link" @click="selectedId = node.spanId">{{ node.name }}</button>
            <div class="timeline-track">
              <span :class="{ unfinished: !node.endedAt }" :style="timeline(node)" />
            </div>
            <span class="timeline-node-duration small">
              {{ formatDuration(duration(node)) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
  <ElDrawer
    :model-value="Boolean(selected)"
    :title="'节点详情 · ' + (selected?.name ?? '')"
    size="min(640px, 100vw)"
    destroy-on-close
    @update:model-value="
      (open: boolean) => {
        if (!open) selectedId = ''
      }
    "
  >
    <section v-if="selected" aria-label="节点详情">
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
        {{ formatDuration(duration(selected)) }}
      </p>
      <p>
        输入 Token {{ selected.inputTokens ?? '未知' }} · 输出 Token
        {{ selected.outputTokens ?? '未知' }} · 用量来源 {{ selected.usageSource ?? '未知' }}
      </p>
      <p
        v-if="!selected.input && !selected.output && selected.payloadSources?.length"
        class="inline-error"
      >
        来源当前不可访问，输入和输出内容已隐藏。
      </p>
      <NodePayload label="节点输入" :payload="selected.input" />
      <NodePayload label="节点输出" :payload="selected.output" />
      <p v-if="selected.routeReason">路由原因：{{ selected.routeReason }}</p>
      <p v-if="selected.toolCallHash" class="mono small">
        工具关联哈希 {{ selected.toolCallHash }}
      </p>
      <p v-if="selected.errorCode" class="inline-error">{{ selected.errorCode }}</p>
    </section>
  </ElDrawer>
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

<style scoped>
.timeline-group {
  border-bottom: 1px solid var(--color-border);
}
.timeline-group-toggle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 20px;
  width: 100%;
  min-height: 48px;
  padding: 12px 8px;
  border: 0;
  border-radius: 8px;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.timeline-group-toggle:hover {
  background: var(--color-surface-soft);
}
.timeline-group-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.timeline-chevron {
  flex-shrink: 0;
}
.timeline-chevron.expanded {
  transform: rotate(90deg);
}
.timeline-group-duration,
.timeline-node-duration {
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.timeline-group-details {
  padding: 0 8px 8px;
}
.timeline-row {
  grid-template-columns: minmax(80px, 180px) minmax(60px, 1fr) minmax(170px, auto);
}
.run-graph-toggle .toggle-hit-area {
  fill: transparent;
}
.run-graph-toggle .toggle-icon {
  fill: var(--color-surface-soft);
  stroke: var(--color-primary);
}
.run-graph-toggle path {
  stroke: var(--color-primary);
  stroke-width: 2px;
  pointer-events: none;
}
.run-graph-toggle:hover .toggle-hit-area {
  fill: var(--color-primary-soft);
}
.run-graph-node:focus-visible rect,
.run-graph-toggle:focus-visible .toggle-icon {
  stroke: #28745f;
  stroke-width: 3px;
}
@media (max-width: 640px) {
  .timeline-row {
    grid-template-columns: minmax(80px, 1fr) minmax(60px, 1fr);
  }
  .timeline-node-duration {
    grid-column: 1 / -1;
  }
}
</style>
