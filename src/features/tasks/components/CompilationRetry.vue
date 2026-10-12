<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import type { RetryPlan, RetryRequest } from '@/shared/api/contracts/taskRetry'
import { retryRequestSchema } from '@/shared/api/contracts/taskRetry'
import type { TaskSnapshot } from '@/shared/api/contracts/backend'
import { tasksApi } from '../api'
import { taskErrorMessages } from '../model'
import { ApiError } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import Feedback from '@/shared/ui/Feedback.vue'
const props = defineProps<{ task: TaskSnapshot }>()
const emit = defineEmits<{ changed: []; invalidated: [error: unknown] }>()
const requests = usePageSignal()
const { busy, error, run } = useAction()
const plan = ref<RetryPlan | null>(null)
const pending = ref<{ key: string; request: RetryRequest } | null>(null)
const fields = [
  {
    key: 'additionalExecutionSeconds',
    remaining: 'remainingExecutionSeconds',
    label: '执行时间（秒）',
    max: 86400,
  },
  { key: 'additionalTurns', remaining: 'remainingTurns', label: '轮数', max: 10000 },
  { key: 'additionalAttempts', remaining: 'remainingAttempts', label: '模型尝试', max: 20000 },
  { key: 'additionalTools', remaining: 'remainingTools', label: '工具次数', max: 10000 },
  { key: 'additionalRepairs', remaining: 'remainingRepairs', label: '修复次数', max: 10000 },
  { key: 'additionalTokens', remaining: 'remainingTokens', label: '词元', max: 10000000 },
  { key: 'additionalAmount', remaining: 'remainingAmount', label: '金额', max: 1000000 },
] as const
const additions = reactive(
  Object.fromEntries(fields.map((f) => [f.key, 0])) as Omit<
    RetryRequest,
    'mode' | 'expectedStateVersion'
  >,
)
const insufficient = computed(
  () => !!plan.value && fields.some((f) => plan.value![f.remaining] + additions[f.key] <= 0),
)
watch(
  () => [props.task.taskId, props.task.stateVersion],
  () => {
    requests.renew()
    plan.value = null
    pending.value = null
    error.value = ''
  },
)
function denied(e: unknown) {
  if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
    plan.value = null
    pending.value = null
    emit('invalidated', e)
  }
}
function load() {
  void run(async () => {
    plan.value = null
    try {
      plan.value = await tasksApi.retryPlan(props.task.taskId, requests.signal)
    } catch (e) {
      denied(e)
      throw e
    }
  })
}
function submit() {
  void run(async () => {
    if (!pending.value) {
      if (!plan.value?.canContinue) throw new Error('请核对续跑资格及剩余额度')
      pending.value = {
        key: crypto.randomUUID(),
        request: retryRequestSchema.parse({
          mode: 'CONTINUE',
          expectedStateVersion: plan.value.stateVersion,
          ...additions,
        }),
      }
    }
    try {
      await tasksApi.retry(
        props.task.taskId,
        pending.value.request,
        pending.value.key,
        requests.signal,
      )
      pending.value = null
      plan.value = null
      emit('changed')
    } catch (e) {
      // A definite rejection permits a new request; uncertain outcomes must replay the exact request.
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![408, 429].includes(e.status)
      ) {
        pending.value = null
        plan.value = null
      }
      denied(e)
      throw e
    }
  })
}
</script>
<template>
  <section class="panel compilation-retry">
    <h3>整编断点续跑</h3>
    <p>
      复用原任务已完成的节点和工作包，保留累计用量。追加额度会提高原任务上限，可能产生新的模型费用。
    </p>
    <el-button :loading="busy" :disabled="!!pending" @click="load">查询续跑资格</el-button>
    <Feedback :error="error" />
    <template v-if="plan">
      <p>
        已完成节点 {{ plan.completedNodes }} · 待处理节点 {{ plan.pendingNodes }} · 已验收包
        {{ plan.acceptedPackages }} · 待处理包 {{ plan.pendingPackages }}
      </p>
      <p>
        {{ plan.canContinue ? '当前失败原因允许续跑，仍须核对额度。' : '当前任务不能普通续跑。' }}
      </p>
      <p v-for="blocker in plan.blockers" :key="blocker" class="inline-error">
        {{ taskErrorMessages[blocker] || blocker }}
      </p>
      <p v-if="plan.errorCode">
        失败原因：{{ taskErrorMessages[plan.errorCode] || plan.errorCode }}（{{ plan.errorCode }}）
      </p>
      <p>剩余额度为负表示已经超额；追加后的总上限由服务端核验。资料及模型容量上限保持原值。</p>
      <el-form label-position="top" class="retry-fields" @submit.prevent="submit">
        <el-form-item
          v-for="f in fields"
          :key="f.key"
          :label="'追加' + f.label"
          :for="'retry-' + f.key"
        >
          <span class="remaining"
            >剩余 {{ plan[f.remaining]
            }}{{ f.key === 'additionalAmount' ? ' ' + plan.currency : '' }}</span
          >
          <el-input-number
            :key="f.key + String(busy || !!pending || !plan.canContinue)"
            :id="'retry-' + f.key"
            v-model="additions[f.key]"
            :min="0"
            :max="f.max"
            :precision="f.key === 'additionalAmount' ? 8 : 0"
            :disabled="busy || !!pending || !plan.canContinue"
          />
        </el-form-item>
      </el-form>
      <p v-if="insufficient" class="inline-error">
        至少一项额度不足，通常需增加对应额度；仅发布已完成结果时以服务端核验为准。
      </p>
      <el-button
        v-if="!pending"
        type="primary"
        :loading="busy"
        :disabled="!plan.canContinue"
        @click="submit"
        >继续原整编任务</el-button
      >
    </template>
    <template v-if="pending">
      <p>提交结果尚未确认，已锁定本次追加值。再次确认会复用原请求，避免重复增加额度。</p>
      <el-button type="primary" :loading="busy" @click="submit">使用原请求重新确认续跑</el-button>
    </template>
  </section>
</template>
<style scoped>
.compilation-retry {
  overflow-wrap: anywhere;
}
.retry-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 0 20px;
}
.remaining {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}
</style>
