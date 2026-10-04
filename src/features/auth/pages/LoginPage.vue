<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../store'
import { safeReturn } from '@/shared/lib/routing'
import { useAction } from '@/shared/lib/useAction'
import Feedback from '@/shared/ui/Feedback.vue'
const auth = useAuth(),
  route = useRoute(),
  router = useRouter()
const username = ref(''),
  password = ref(''),
  { busy, error, run } = useAction()
function login() {
  void run(async () => {
    await auth.login(username.value, password.value)
    password.value = ''
    await router.replace(
      auth.user?.passwordChangeRequired ? '/change-password' : safeReturn(route.query.redirect),
    )
  })
}
</script>
<template>
  <div class="login-page">
    <section class="login-story">
      <div class="brand brand-light">
        <span class="brand-mark">N<span>·</span></span>
        <div><strong>Novid</strong><small>知识工作台</small></div>
      </div>
      <div class="story-body">
        <span class="eyebrow">YOUR KNOWLEDGE, CONNECTED</span>
        <h1>让积累的知识，<br />回应新的问题。</h1>
        <p>把资料汇成知识库，从答案回到出处，<br />让每一次探索都有迹可循。</p>
        <div class="knowledge-art" aria-hidden="true">
          <div class="art-orbit orbit-one" />
          <div class="art-orbit orbit-two" />
          <div class="art-card card-one">
            <span>01 / COLLECT</span><strong>收集资料</strong><i /><i /><i />
          </div>
          <div class="art-card card-two">
            <span>02 / CONNECT</span><strong>连接知识</strong>
            <div class="art-dots">● ── ● ── ●</div>
          </div>
          <div class="art-core">N<span>·</span></div>
          <div class="art-chip">从出处，到洞见 ↗</div>
        </div>
      </div>
      <span class="story-footer">A calmer place to think.</span>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <span class="eyebrow">WELCOME BACK</span>
        <h2>欢迎回到工作台</h2>
        <p class="muted">使用管理员提供的账号，开始你的知识探索。</p>
        <Feedback
          :error="error"
          :notice="route.query.changed === '1' ? '密码已修改，请重新登录。' : undefined"
        /><el-form label-position="top" @submit.prevent="login"
          ><el-form-item label="用户名" for="username"
            ><el-input
              id="username"
              v-model="username"
              autocomplete="username"
              placeholder="输入用户名"
              size="large" /></el-form-item
          ><el-form-item label="密码" for="password"
            ><el-input
              id="password"
              v-model="password"
              type="password"
              show-password
              autocomplete="current-password"
              placeholder="输入密码"
              size="large" /></el-form-item
          ><el-button
            native-type="submit"
            type="primary"
            size="large"
            :loading="busy"
            class="full-width"
            >登录工作台 →</el-button
          ></el-form
        >
        <p class="login-footnote">账号由管理员创建。首次登录后，请先设置自己的密码。</p>
      </div>
      <span class="panel-footer">资料有边界，探索有依据。</span>
    </section>
  </div>
</template>
