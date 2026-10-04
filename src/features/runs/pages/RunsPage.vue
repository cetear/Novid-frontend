<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { runsApi } from '../api'
import type { TraceSnapshot } from '@/shared/api/contracts/backend'
import { useLoad } from '@/shared/lib/useLoad'
import { dateTime } from '@/shared/lib/format'
import PageHeader from '@/shared/ui/PageHeader.vue'
import PageStepper from '@/shared/ui/PageStepper.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
import Feedback from '@/shared/ui/Feedback.vue'
const page = ref(0),
  { data, loading, loadError, load } = useLoad<TraceSnapshot[]>()
function refresh(n = page.value) {
  page.value = n
  void load(() => runsApi.list(n))
}
onMounted(() => refresh())
</script>
<template>
  <PageHeader
    eyebrow="RUN SUMMARIES"
    title="每一次运行，都有记录。"
    description="展示本人记录，打开详情查看持久节点、实际时间线与执行关系。"
    ><el-button :loading="loading" @click="refresh()">刷新</el-button></PageHeader
  ><Feedback :error="loadError" />
  <section class="panel">
    <el-table :data="data || []" v-loading="loading"
      ><el-table-column label="运行标识" min-width="260"
        ><template #default="{ row }"
          ><RouterLink :to="'/runs/' + encodeURIComponent(row.traceId)" class="mono">{{
            row.traceId
          }}</RouterLink></template
        ></el-table-column
      ><el-table-column label="状态" width="160"
        ><template #default="{ row }"
          ><StatusBadge :status="row.status" /></template></el-table-column
      ><el-table-column prop="modelId" label="模型标识" /><el-table-column
        prop="attempts"
        label="尝试次数"
        width="100"
      /><el-table-column label="时间" min-width="180"
        ><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column
      ><el-table-column label="测试结果" width="100"
        ><template #default="{ row }">{{ row.mock ? '是' : '否' }}</template></el-table-column
      ></el-table
    ><PageStepper :page="page" :count="data?.length" :busy="loading" @change="refresh" />
  </section>
</template>
