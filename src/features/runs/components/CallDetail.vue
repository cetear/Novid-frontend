<script setup lang="ts">
import { ref, watch } from 'vue'
import type { z } from 'zod'
import type { callDetailSchema, payloadPageSchema } from '@/shared/api/contracts/modelCalls'
import { runsApi } from '../api'
import { ApiError, errorMessage } from '@/shared/api/errors'
import { useLoad } from '@/shared/lib/useLoad'
import { useAction } from '@/shared/lib/useAction'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import Feedback from '@/shared/ui/Feedback.vue'
import ValidationDiagnostic from './ValidationDiagnostic.vue'
import PayloadInfo from './PayloadInfo.vue'
const props = defineProps<{ traceId: string; callId: string }>()
const emit = defineEmits<{ invalidated: [error: unknown] }>()
const detail = useLoad<z.infer<typeof callDetailSchema>>()
const payload = useLoad<z.infer<typeof payloadPageSchema>>()
const downloads = usePageSignal()
const action = useAction()
const side = ref<'INPUT' | 'OUTPUT'>('INPUT'),
  view = ref<'raw' | 'model'>('raw')
const cursors = ref<Array<string | undefined>>([undefined]),
  page = ref(0)
function guard(e: unknown) {
  if (
    e instanceof ApiError &&
    ['MODEL_CALL_PAYLOAD_UNAVAILABLE', 'MODEL_CALL_PAYLOAD_CORRUPT'].includes(e.code)
  ) {
    // Download may report revoked content as unavailable; discard every private snapshot.
    payload.reset()
    detail.reset()
    action.error.value = errorMessage(e)
  }
  if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
    detail.data.value = null
    payload.data.value = null
    emit('invalidated', e)
  }
}
function refresh() {
  payload.reset()
  cursors.value = [undefined]
  page.value = 0
  downloads.renew()
  void detail.load(async (signal) => {
    try {
      return await runsApi.call(props.traceId, props.callId, signal)
    } catch (e) {
      if (!signal.aborted) guard(e)
      throw e
    }
  })
}
watch(() => [props.traceId, props.callId], refresh, { immediate: true })
watch([side, view], () => {
  cursors.value = [undefined]
  page.value = 0
  // Starting a new read invalidates every outstanding page response.
  void payload.load(async (signal) => {
    try {
      return await runsApi.payload(
        props.traceId,
        props.callId,
        side.value,
        side.value === 'INPUT' ? 'raw' : view.value,
        undefined,
        signal,
      )
    } catch (e) {
      if (!signal.aborted) guard(e)
      throw e
    }
  })
})
function read(next = 0) {
  const cursor = cursors.value[next]
  void payload.load(async (signal) => {
    try {
      const result = await runsApi.payload(
        props.traceId,
        props.callId,
        side.value,
        side.value === 'INPUT' ? 'raw' : view.value,
        cursor,
        signal,
      )
      if (!signal.aborted) {
        page.value = next
        cursors.value = cursors.value.slice(0, next + 1)
        if (result.nextCursor !== null) cursors.value.push(result.nextCursor)
      }
      return result
    } catch (e) {
      if (!signal.aborted) guard(e)
      throw e
    }
  })
}
function download() {
  const currentSide = side.value
  const signal = downloads.renew()
  void action.run(async () => {
    try {
      const result = await runsApi.download(props.traceId, props.callId, currentSide, signal)
      if (signal.aborted) return
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `model-call-${props.callId.replace(/[^\w-]/g, '_')}-${currentSide}.txt`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      if (!signal.aborted) guard(e)
      throw e
    }
  })
}
</script>
<template>
  <section
    class="call-detail"
    aria-label="模型调用详情"
    :aria-busy="detail.loading.value || payload.loading.value"
  >
    <el-button :loading="detail.loading.value" @click="refresh">重新核验调用</el-button>
    <Feedback :error="detail.loadError.value || action.error.value" />
    <template v-if="detail.data.value">
      <h4>调用 {{ detail.data.value.call.callId }}</h4>
      <p>
        提供方调用：{{ detail.data.value.call.callStatus }} · 本地校验：{{
          detail.data.value.call.validationStatus
        }}
      </p>
      <p>
        模型 {{ detail.data.value.call.modelId }} · 第 {{ detail.data.value.call.attempt }} 次尝试 ·
        发送 {{ detail.data.value.call.sendState }}
      </p>
      <p>
        HTTP {{ detail.data.value.call.httpMillis }} ms · 校验
        {{ detail.data.value.call.validationMillis }} ms
      </p>
      <p class="mono small">
        契约 {{ detail.data.value.call.context.schemaId }} /
        {{ detail.data.value.call.context.schemaVersion }} ·
        {{ detail.data.value.call.context.contractHash }}
      </p>
      <p v-if="detail.data.value.call.errorCode" class="inline-error">
        {{ detail.data.value.call.errorCode }}
      </p>
      <p>HTTP 成功不代表本地校验通过；调用费用仍按实际提供方用量记录。</p>
      <ValidationDiagnostic :diagnostic="detail.data.value.call.diagnostic" />
      <PayloadInfo label="输入" :payload="detail.data.value.input" />
      <PayloadInfo label="输出" :payload="detail.data.value.output" />
      <div class="toolbar">
        <label
          >正文方向
          <select v-model="side">
            <option value="INPUT">请求正文</option>
            <option value="OUTPUT">响应正文</option>
          </select></label
        >
        <label v-if="side === 'OUTPUT'"
          >响应展示
          <select v-model="view">
            <option value="raw">提供方完整响应</option>
            <option value="model">模型输出文本</option>
          </select></label
        >
        <el-button
          :loading="payload.loading.value"
          :disabled="detail.data.value[side === 'INPUT' ? 'input' : 'output'].state !== 'READY'"
          @click="read()"
          >读取正文首页</el-button
        >
        <el-button
          :loading="action.busy.value"
          :disabled="detail.data.value[side === 'INPUT' ? 'input' : 'output'].state !== 'READY'"
          @click="download"
          >下载{{ side === 'INPUT' ? '请求' : '提供方响应' }}原始正文</el-button
        >
      </div>
      <p>全文每页替换显示；归档不可用或损坏时不会重新调用模型。下载中断视为失败。</p>
      <Feedback :error="payload.loadError.value" />
      <template v-if="payload.data.value">
        <p>
          第 {{ page + 1 }} 页 · {{ payload.data.value.contentKind }} ·
          {{ payload.data.value.content.length }} UTF-16 单位
        </p>
        <pre class="payload-text" tabindex="0">{{
          payload.data.value.content === '' ? '（已归档的空正文）' : payload.data.value.content
        }}</pre>
        <div class="toolbar">
          <el-button :disabled="page === 0 || payload.loading.value" @click="read(page - 1)"
            >正文上一页</el-button
          >
          <el-button
            :disabled="payload.data.value.nextCursor === null || payload.loading.value"
            @click="read(page + 1)"
            >正文下一页</el-button
          >
        </div>
      </template>
    </template>
  </section>
</template>
<style scoped>
.call-detail {
  overflow-wrap: anywhere;
  min-width: 0;
}
.payload-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 480px;
  overflow: auto;
  padding: 12px;
  background: var(--color-surface-soft);
}
select {
  max-width: 100%;
  padding: 8px;
}
</style>
