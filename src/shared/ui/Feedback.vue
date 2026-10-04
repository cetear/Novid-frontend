<script setup lang="ts">
defineProps<{ error?: string; notice?: string }>()
</script>
<template>
  <el-alert
    v-if="error"
    :title="error"
    type="error"
    :closable="false"
    show-icon
    class="feedback"
  /><el-alert
    v-if="notice"
    :title="notice"
    type="info"
    :closable="false"
    show-icon
    class="feedback"
  />
</template>
