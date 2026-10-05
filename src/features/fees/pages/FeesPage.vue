<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FeeKind } from '../api'
import FeePanel from '../components/FeePanel.vue'
import PageHeader from '@/shared/ui/PageHeader.vue'
import Feedback from '@/shared/ui/Feedback.vue'
import { positiveId } from '@/shared/lib/validation'
const route = useRoute(),
  router = useRouter()
const kind = ref<FeeKind>(
  ['runs', 'tasks', 'ingestions'].includes(String(route.query.kind))
    ? (route.query.kind as FeeKind)
    : 'tasks',
)
const resource = ref(String(route.query.id ?? '')),
  error = ref('')
const selection = computed(() =>
  ['runs', 'tasks', 'ingestions'].includes(String(route.query.kind)) && route.query.id
    ? { kind: route.query.kind as FeeKind, id: String(route.query.id) }
    : null,
)
function query() {
  error.value = ''
  try {
    const value = resource.value.trim()
    if (!value || (kind.value === 'runs' && !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)))
      throw new Error('请输入合法的运行标识')
    if (kind.value !== 'runs') positiveId(value)
    void router.replace({ path: '/fees', query: { kind: kind.value, id: value } })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '请核对标识'
  }
}
</script>
<template>
  <PageHeader
    eyebrow="PERSONAL LEDGER"
    title="每一次使用，都有迹可循。"
    description="按已知运行、任务或入库代次查询本人费用，查看估算、预留和未知记录。"
  />
  <section class="panel">
    <h2>查询费用记录</h2>
    <form class="toolbar" @submit.prevent="query">
      <label
        >记录类型
        <select v-model="kind" aria-label="费用记录类型">
          <option value="tasks">任务</option>
          <option value="runs">运行</option>
          <option value="ingestions">入库代次</option>
        </select></label
      ><el-input
        v-model="resource"
        aria-label="费用资源标识"
        placeholder="输入已知 ID 或运行标识"
      /><el-button type="primary" native-type="submit">查询费用</el-button>
    </form>
    <Feedback :error="error" />
    <p class="muted small">
      入库使用 ingestionId，可在文档处理详情取得；它与文档 ID 不同。这里不提供完整账单列表。
    </p>
  </section>
  <FeePanel
    v-if="selection"
    :key="selection.kind + selection.id"
    :kind="selection.kind"
    :resource-id="selection.id"
  />
  <div v-else class="quiet-note">
    <h3>先选择一条记录</h3>
    <p>也可以从运行检查或任务详情直接查看对应费用。</p>
  </div>
</template>
