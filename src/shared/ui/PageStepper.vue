<script setup lang="ts">
defineProps<{ page: number; busy?: boolean; count?: number }>()
defineEmits<{ change: [page: number] }>()
</script>
<template>
  <div class="page-stepper">
    <span class="muted"
      >第 {{ page + 1 }} 页<span v-if="count !== undefined"> · 本页 {{ count }} 项</span></span
    >
    <div>
      <el-button :disabled="busy || page === 0" @click="$emit('change', page - 1)">上一页</el-button
      ><el-button :disabled="busy || page >= 10000" @click="$emit('change', page + 1)"
        >下一页</el-button
      >
    </div>
  </div>
</template>
