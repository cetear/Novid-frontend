<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute } from 'vue-router'
import { Menu, ArrowRight } from '@element-plus/icons-vue'
import { useAuth } from '@/features/auth'
import { navigation } from './capabilities'
import WorkspaceNav from './layouts/WorkspaceNav.vue'
const auth = useAuth(),
  route = useRoute(),
  mobileOpen = ref(false)
const currentPage = computed(
  () =>
    navigation.find((item) => route.path.startsWith(item.path))?.title ??
    (route.path.startsWith('/documents')
      ? '文档详情'
      : route.path.startsWith('/admin/operations')
        ? '运营与审计'
        : route.path.startsWith('/admin')
          ? '用户管理'
          : route.path.startsWith('/approvals')
            ? '笔记确认'
            : '账户设置'),
)
watch(
  () => route.path,
  async () => {
    mobileOpen.value = false
    await nextTick()
    document.getElementById('main-content')?.focus({ preventScroll: true })
  },
)
</script>
<template>
  <el-config-provider :locale="zhCn">
    <div v-if="!auth.token || route.path === '/login'" class="public-layout">
      <RouterView :key="route.fullPath" />
    </div>
    <div v-else class="app-shell">
      <a href="#main-content" class="skip-link">跳到主要内容</a>
      <aside class="sidebar"><WorkspaceNav /></aside>
      <el-drawer
        v-model="mobileOpen"
        direction="ltr"
        size="264px"
        :with-header="false"
        class="mobile-navigation"
        aria-label="工作空间导航"
        ><WorkspaceNav mobile @navigate="mobileOpen = false"
      /></el-drawer>
      <div class="workspace">
        <header class="topbar">
          <div class="topbar-location">
            <el-button
              class="mobile-menu"
              text
              aria-label="打开导航"
              :aria-expanded="mobileOpen"
              @click="mobileOpen = true"
              ><el-icon><Menu /></el-icon></el-button
            ><span class="topbar-label">工作空间</span
            ><el-icon aria-hidden="true"><ArrowRight /></el-icon><strong>{{ currentPage }}</strong>
          </div>
          <span class="session-label"
            ><span class="live-dot" />{{
              auth.user?.passwordChangeRequired ? '需要修改密码' : '私人工作空间'
            }}</span
          >
        </header>
        <main id="main-content" class="main-content" tabindex="-1">
          <RouterView :key="`${auth.epoch}:${route.fullPath}`" />
        </main>
        <footer class="workspace-footer">
          <span>Novid <b>·</b> Make knowledge work.</span><span>结果有出处，创作有依据。</span>
        </footer>
      </div>
    </div>
  </el-config-provider>
</template>
