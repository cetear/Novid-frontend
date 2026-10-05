<script setup lang="ts">
import { watch } from 'vue'
import { feesApi, type FeeKind } from '../api'
import type { FeeSummary } from '@/shared/api/contracts/media'
import { useLoad } from '@/shared/lib/useLoad'
import Feedback from '@/shared/ui/Feedback.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
const props = defineProps<{ kind: FeeKind; resourceId: string | number }>()
const { data, loading, loadError, load } = useLoad<FeeSummary>()
function refresh() {
  void load((signal) => feesApi.get(props.kind, props.resourceId, signal))
}
watch(() => [props.kind, props.resourceId], refresh, { immediate: true })
</script>
<template>
  <section class="panel fee-panel">
    <div class="section-title">
      <div>
        <span class="eyebrow">COST & USAGE</span>
        <h2>费用与用量</h2>
      </div>
      <el-button :loading="loading" @click="refresh">核对费用</el-button>
    </div>
    <Feedback :error="loadError" />
    <el-skeleton v-if="loading" :rows="2" animated />
    <template v-if="data">
      <StatusBadge :status="data.costStatus" />
      <div class="stats-grid fee-stats">
        <div class="stat-card">
          <span>已计价估算 · {{ data.currency ?? '币种未知' }}</span
          ><strong>{{ data.estimatedAmount }}</strong
          ><small>价格快照计算，非实付账单</small>
        </div>
        <div class="stat-card">
          <span>已报价预留 · {{ data.currency ?? '币种未知' }}</span
          ><strong>{{ data.reservedAmount }}</strong
          ><small>未知成本可能未计入</small>
        </div>
        <div class="stat-card">
          <span>原范围上限 · {{ data.currency ?? '币种未知' }}</span
          ><strong>{{ data.limitAmount ?? '未登记' }}</strong
          ><small>恢复和返工不会重置上限</small>
        </div>
      </div>
      <el-alert
        v-if="data.costStatus === 'UNKNOWN' || data.overLimit"
        :title="
          data.overLimit
            ? '费用已超范围，请核对原任务。'
            : '费用存在未知、未结算或旧缺账记录，不能视为零费用。'
        "
        type="warning"
        :closable="false"
      />
      <dl class="fact-grid">
        <div>
          <dt>记录意图 / 已结算</dt>
          <dd>{{ data.attempts }} / {{ data.settledAttempts }}</dd>
        </div>
        <div>
          <dt>未知 / 待结算</dt>
          <dd>{{ data.unknownAttempts }} / {{ data.pendingAttempts }}</dd>
        </div>
        <div>
          <dt>模拟 / 历史缺账</dt>
          <dd>{{ data.simulatedAttempts }} / {{ data.legacyUntrackedAttempts }}</dd>
        </div>
        <div>
          <dt>提供方输入 / 输出词元</dt>
          <dd>{{ data.providerInputTokens }} / {{ data.providerOutputTokens }}</dd>
        </div>
        <div>
          <dt>保守预留词元</dt>
          <dd>{{ data.reservedTokens }}</dd>
        </div>
      </dl>
      <p class="muted small">
        已知用量与预留分别展示，不合计为实际总量；记录意图不等于实际发送次数。取消不代表退款。
      </p>
    </template>
  </section>
</template>
