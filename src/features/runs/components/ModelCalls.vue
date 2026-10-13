<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { runsApi } from '../api'
import type { z } from 'zod'
import type { callDetailSchema } from '@/shared/api/contracts/modelCalls'
import { useLoad } from '@/shared/lib/useLoad'
import { ApiError } from '@/shared/api/errors'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
import CallDetail from './CallDetail.vue'
const props = defineProps<{ traceId: string; nodeId?: string; initialCallId?: string | null }>()
const emit = defineEmits<{ invalidated: [error: unknown] }>()
const list = useLoad<z.infer<typeof callDetailSchema>[]>()
const page = ref(0),
  selected = ref(props.initialCallId || '')
const singleCall = computed(() => !props.nodeId && Boolean(props.initialCallId))
watch(
  () => [props.traceId, props.nodeId, props.initialCallId],
  () => {
    selected.value = props.initialCallId || ''
    page.value = 0
    load(0)
  },
)
function invalidated(e: unknown) {
  selected.value = ''
  list.data.value = null
  emit('invalidated', e)
}
function load(next = page.value) {
  selected.value = ''
  void list.load(async (signal) => {
    try {
      // A MODEL span identifies one attempt, even when retries share a business node.
      const result = singleCall.value
        ? [await runsApi.call(props.traceId, props.initialCallId!, signal)]
        : await runsApi.calls(props.traceId, next, props.nodeId, signal)
      if (!signal.aborted) {
        page.value = next
        selected.value = props.initialCallId || ''
      }
      return result
    } catch (e) {
      if (!signal.aborted && e instanceof ApiError && [401, 403, 404].includes(e.status))
        invalidated(e)
      throw e
    }
  })
}
</script>
<template>
  <section class="model-calls">
    <h3>
      {{ singleCall ? '当前节点模型调用' : nodeId ? '业务节点各次模型尝试' : '独立模型调用记录' }}
    </h3>
    <p v-if="singleCall">仅查看当前节点这一次调用的输入与输出。旧记录可能未采集全文。</p>
    <p v-else>首次、备用、纠正分别记录；复用检查点不会产生新调用。旧记录可能未采集全文。</p>
    <el-button :loading="list.loading.value" @click="load()">查询模型调用</el-button>
    <Feedback :error="list.loadError.value" />
    <p v-if="list.data.value?.length === 0">本页没有已记录调用；图丢失不代表没有独立调用记录。</p>
    <article v-for="{ call } in list.data.value || []" :key="call.callId">
      <p>
        {{ call.context.businessNodeId }} · {{ call.modelId }} · 尝试 {{ call.attempt }} · 提供方
        {{ call.callStatus }} · 校验 {{ call.validationStatus }}
      </p>
      <el-button @click="selected = call.callId">查看调用 {{ call.callId }}</el-button>
    </article>
    <PageStepper
      v-if="list.data.value && !singleCall"
      :page="page"
      :busy="list.loading.value"
      :count="list.data.value.length"
      @change="load"
    />
    <CallDetail
      v-if="selected"
      :key="traceId + ':' + selected"
      :trace-id="traceId"
      :call-id="selected"
      @invalidated="invalidated"
    />
  </section>
</template>
<style scoped>
.model-calls {
  overflow-wrap: anywhere;
  min-width: 0;
}
.model-calls :deep(.el-button) {
  max-width: 100%;
  height: auto;
  min-height: 36px;
  white-space: normal;
}
.model-calls :deep(.el-button > span) {
  min-width: 0;
  overflow-wrap: anywhere;
}
article {
  margin: 16px 0;
}
</style>
