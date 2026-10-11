<script setup lang="ts">
import { ref, watch, onScopeDispose } from 'vue'
import { useRouter } from 'vue-router'
import { knowledgeApi } from '@/features/knowledge/api'
import { tasksApi } from '../api'
import type { KnowledgeBaseSnapshot } from '@/shared/api/contracts/backend'
import { useAction } from '@/shared/lib/useAction'
import Feedback from '@/shared/ui/Feedback.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
const props = defineProps<{ taskId: number }>(),
  router = useRouter()
const { busy, error, run } = useAction()
let disposed = false
onScopeDispose(() => {
  disposed = true
})
const bases = ref<KnowledgeBaseSnapshot[]>([]),
  target = ref<number>(),
  page = ref(0),
  key = ref(crypto.randomUUID()),
  prepared = ref(false)
watch(target, () => {
  key.value = crypto.randomUUID()
  prepared.value = false
})
function load(next = 0) {
  void run(async () => {
    bases.value = []
    bases.value = (
      await knowledgeApi.bases({ mode: 'SELF', knowledgeBaseIds: [], ownerUserId: null }, next)
    ).filter((b) => b.enabled && !b.deleted)
    page.value = next
  })
}
function prepare() {
  void run(async () => {
    if (!target.value) return
    const saved = await tasksApi.prepareCompilation(props.taskId, target.value, key.value)
    if (disposed) return
    prepared.value = true
    await router.push(
      '/approvals/' + encodeURIComponent(saved.approval.approvalId) + '?compilationSave=1',
    )
  })
}
function newRequest() {
  key.value = crypto.randomUUID()
  prepared.value = false
}
</script>
<template>
  <section class="panel">
    <h3>保存整编为资料</h3>
    <p>核对完整结果后，保存到自己的启用知识库；批准保存后，等待索引 READY 再进行单文档自测。</p>
    <Feedback :error="error" /><el-button :loading="busy" @click="load()">加载目标知识库</el-button
    ><el-select
      v-model="target"
      aria-label="整编保存目标知识库"
      placeholder="选择自己的启用知识库"
      :disabled="busy"
      ><el-option v-for="b in bases" :key="b.id" :label="b.name" :value="b.id" /></el-select
    ><PageStepper :page="page" :busy="busy" @change="load" /><el-button
      type="primary"
      :disabled="!target || busy"
      @click="prepare"
      >准备保存并核对</el-button
    >
    <p class="muted small">
      请求不确定时保持目标，重试使用同一保存标识。到期或拒绝后需明确重新准备。
    </p>
    <el-button v-if="prepared || error" :disabled="busy" @click="newRequest"
      >明确开始新的保存请求</el-button
    >
  </section>
</template>

<style scoped>
.el-select {
  width: min(100%, 360px);
  margin-block: 12px;
}
</style>
