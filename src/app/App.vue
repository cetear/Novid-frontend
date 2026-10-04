<script setup lang="ts">
import { ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute } from 'vue-router'
import {
  ChatDotRound,
  Collection,
  Document,
  Star,
  DataLine,
  User,
  Setting,
  Menu,
  ArrowRight,
} from '@element-plus/icons-vue'
import { useAuth } from '@/features/auth'
import { navigation } from './capabilities'
const auth = useAuth(),
  route = useRoute(),
  mobileOpen = ref(false)
const icons = { ChatDotRound, Collection, Document, Star, DataLine }
</script>
<template>
  <el-config-provider :locale="zhCn"
    ><div v-if="!auth.token || route.path === '/login'" class="public-layout">
      <RouterView :key="route.fullPath" />
    </div>
    <div v-else class="app-shell">
      <div v-if="mobileOpen" class="nav-backdrop" @click="mobileOpen = false" />
      <aside class="sidebar" :class="{ open: mobileOpen }">
        <RouterLink to="/chat" class="brand"
          ><span class="brand-mark">N<span>·</span></span>
          <div><strong>Novid</strong><small>知识工作台</small></div></RouterLink
        >
        <div class="nav-label">WORKSPACE</div>
        <nav aria-label="主导航">
          <RouterLink
            v-for="item in navigation"
            :key="item.path"
            :to="item.path"
            class="nav-item"
            @click="mobileOpen = false"
            ><el-icon><component :is="icons[item.icon as keyof typeof icons]" /></el-icon
            ><span>{{ item.title }}</span
            ><el-icon class="nav-arrow"><ArrowRight /></el-icon></RouterLink
          ><RouterLink
            v-if="auth.user?.role === 'ADMIN'"
            to="/admin/users"
            class="nav-item"
            @click="mobileOpen = false"
            ><el-icon><User /></el-icon><span>用户管理</span></RouterLink
          >
        </nav>
        <div class="sidebar-note">
          <span class="note-dot" /><strong>让知识，成为答案。</strong>
          <p>连接资料、保留出处，<br />把每一次探索沉淀下来。</p>
        </div>
        <RouterLink to="/settings" class="profile" @click="mobileOpen = false"
          ><span class="avatar">{{ auth.user?.username.slice(0, 1).toUpperCase() }}</span
          ><span
            ><strong>{{ auth.user?.username }}</strong
            ><small>{{ auth.user?.role === 'ADMIN' ? '管理员' : '个人工作空间' }}</small></span
          ><el-icon><Setting /></el-icon
        ></RouterLink>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <el-button class="mobile-menu" text aria-label="打开导航" @click="mobileOpen = true"
            ><el-icon><Menu /></el-icon></el-button
          ><span class="topbar-label">个人知识 · 持续积累</span
          ><span class="session-label"
            ><span class="live-dot" />
            {{ auth.user?.passwordChangeRequired ? '需要修改密码' : '已登录' }}</span
          >
        </header>
        <main class="main-content"><RouterView :key="`${auth.epoch}:${route.fullPath}`" /></main>
        <footer class="workspace-footer">
          <span>Novid / Knowledge Workspace</span
          ><span>会话使用有限上下文 · 结果请结合来源核对</span>
        </footer>
      </div>
    </div></el-config-provider
  >
</template>
