<script setup lang="ts">
import {
  ChatDotRound,
  Collection,
  Document,
  Star,
  DataLine,
  User,
  Setting,
  ArrowRight,
  Wallet,
  Monitor,
  Plus,
  Close,
} from '@element-plus/icons-vue'
import { useAuth } from '@/features/auth'
import { navigation } from '../capabilities'
defineProps<{ mobile?: boolean }>()
const emit = defineEmits<{ navigate: [] }>(),
  auth = useAuth()
const icons = { ChatDotRound, Collection, Document, Star, DataLine, Wallet }
</script>
<template>
  <RouterLink to="/chat" class="brand" @click="emit('navigate')"
    ><span class="brand-mark">N<span>·</span></span>
    <div><strong>Novid</strong><small>KNOWLEDGE STUDIO</small></div></RouterLink
  >
  <el-button v-if="mobile" class="nav-close" text aria-label="关闭导航" @click="emit('navigate')"
    ><el-icon><Close /></el-icon
  ></el-button>
  <RouterLink to="/tasks" class="new-work" @click="emit('navigate')"
    ><el-icon aria-hidden="true"><Plus /></el-icon>创建新任务<small>↗</small></RouterLink
  >
  <div class="nav-label">工作空间 <span>WORKSPACE</span></div>
  <nav aria-label="主导航">
    <RouterLink
      v-for="item in navigation"
      :key="item.path"
      :to="item.path"
      class="nav-item"
      @click="emit('navigate')"
      ><el-icon aria-hidden="true"
        ><component :is="icons[item.icon as keyof typeof icons]" /></el-icon
      ><span>{{ item.title }}</span
      ><el-icon class="nav-arrow" aria-hidden="true"><ArrowRight /></el-icon
    ></RouterLink>
  </nav>
  <template v-if="auth.user?.role === 'ADMIN'"
    ><div class="nav-label admin-nav-label">管理 <span>ADMIN</span></div>
    <nav aria-label="管理导航">
      <RouterLink to="/admin/users" class="nav-item" @click="emit('navigate')"
        ><el-icon aria-hidden="true"><User /></el-icon><span>用户管理</span></RouterLink
      ><RouterLink to="/admin/operations" class="nav-item" @click="emit('navigate')"
        ><el-icon aria-hidden="true"><Monitor /></el-icon><span>运营与审计</span></RouterLink
      >
    </nav></template
  >
  <div class="sidebar-note">
    <span class="note-dot" /><strong>从资料，到洞见。</strong>
    <p>保留出处，连接知识。<br />让每一次创作有据可循。</p>
  </div>
  <RouterLink to="/settings" class="profile" @click="emit('navigate')"
    ><span class="avatar">{{ auth.user?.username.slice(0, 1).toUpperCase() }}</span
    ><span
      ><strong>{{ auth.user?.username }}</strong
      ><small>{{ auth.user?.role === 'ADMIN' ? '管理员' : '个人工作空间' }}</small></span
    ><el-icon aria-hidden="true"><Setting /></el-icon
  ></RouterLink>
</template>
