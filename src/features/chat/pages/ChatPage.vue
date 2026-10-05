<script setup lang="ts">
import { ref, watch, onScopeDispose, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  Promotion,
  Collection,
  Document,
  Close,
  MagicStick,
  Setting,
  ChatDotRound,
} from '@element-plus/icons-vue'
import { useAuth } from '@/features/auth'
import { ScopePicker, SourceDrawer, OwnBaseSelect, useKnowledgeScope } from '@/features/knowledge'
import { chatApi, dependenciesFrom } from '../api'
import { useSessions } from '../useSessions'
import { sessionsApi } from '../sessionsApi'
import type { AiResult, EvidenceBundle, ChatOptions } from '@/shared/api/contracts/backend'
import { ApiError, errorMessage, isAbort } from '@/shared/api/errors'
import { useAction } from '@/shared/lib/useAction'
import { positiveId } from '@/shared/lib/validation'
import { usePageSignal } from '@/shared/lib/usePageSignal'
import Feedback from '@/shared/ui/Feedback.vue'
import MarkdownView from '@/shared/ui/MarkdownView.vue'
import StatusBadge from '@/shared/ui/StatusBadge.vue'
import ChatSessionList from '../components/ChatSessionList.vue'
import '../chat-workspace.css'
interface Message {
  id: string
  question: string
  answer: string
  citations: EvidenceBundle[]
  result: AiResult | null
  stage: string
  error: string
  historyCursor: number
}
const auth = useAuth(),
  scope = useKnowledgeScope(),
  router = useRouter()
const question = ref(''),
  streaming = ref(true),
  sending = ref(false),
  messages = ref<Message[]>([]),
  source = ref<EvidenceBundle | null>(null)
const sessions = useSessions()
const displayedHistory = computed(() => {
  const latest = sessions.active.value ? messages.value.at(-1) : null
  return latest?.result
    ? sessions.history.value.filter(
        (event) => event.seq <= latest.historyCursor || !['USER', 'ASSISTANT'].includes(event.role),
      )
    : sessions.history.value
})
const settingsOpen = ref(false),
  sessionListOpen = ref(false),
  thread = ref<HTMLElement | null>(null)
const compactQuery = window.matchMedia('(max-width: 1100px)'),
  compact = ref(compactQuery.matches)
function resizeWorkspace(event: MediaQueryListEvent) {
  compact.value = event.matches
  sessionListOpen.value = false
}
compactQuery.addEventListener('change', resizeWorkspace)
onScopeDispose(() => compactQuery.removeEventListener('change', resizeWorkspace))
let followConversation = true
function trackScroll() {
  if (thread.value)
    followConversation =
      thread.value.scrollHeight - thread.value.scrollTop - thread.value.clientHeight < 160
}
watch(
  () => [messages.value.map((m) => m.answer + m.stage).join(''), sessions.history.value],
  async () => {
    if (!followConversation) return
    await nextTick()
    thread.value?.scrollTo({ top: thread.value.scrollHeight })
  },
  { deep: true },
)
const conversationTitle = computed(
  () => sessions.active.value?.title || (sessions.active.value ? '未命名会话' : '单轮问答'),
)
const modelLabel = computed(
  () =>
    ({ knowledge: '知识问答', economy: '经济', analysis: '分析', report: '报告' })[
      modelProfile.value ?? 'knowledge'
    ],
)
const modelProfile = ref<ChatOptions['modelProfile']>(),
  responseFormat = ref<'TEXT' | 'STRUCTURED'>('TEXT'),
  toolMode = ref<'OFF' | 'READ_ONLY'>('OFF')
const tools = ref<Awaited<ReturnType<typeof sessionsApi.tools>>>([]),
  toolsLoaded = ref(false)
watch(toolMode, (value) => {
  if (value === 'READ_ONLY') responseFormat.value = 'TEXT'
})
async function loadTools() {
  await run(async () => {
    tools.value = await sessionsApi.tools(noteRequests.signal)
    toolsLoaded.value = true
  })
}
const noteOpen = ref(false),
  target = ref<number | null>(null),
  noteTitle = ref(''),
  noteText = ref(''),
  noteResult = ref<AiResult | null>(null)
const { busy, error, run } = useAction(),
  noteRequests = usePageSignal()
let controller: AbortController | undefined,
  generation = 0,
  frame = 0,
  pending: (() => void) | null = null
const suggestions = [
  '统计当前范围的文档数量',
  '请根据资料归纳核心概念，并列出出处',
  '资料中的实施步骤和注意事项有哪些？',
]
const scopeLabel = computed(() =>
  scope.scope.mode === 'SELF'
    ? '我的资料'
    : scope.scope.mode === 'ALL'
      ? '全部授权资料'
      : '指定 ' + scope.scope.knowledgeBaseIds.length + ' 个知识库',
)
function clear() {
  noteRequests.renew()
  generation++
  controller?.abort()
  cancelAnimationFrame(frame)
  pending = null
  frame = 0
  sending.value = false
  messages.value = []
  source.value = null
  noteOpen.value = false
  noteResult.value = null
  noteText.value = ''
  noteTitle.value = ''
}
watch(
  () => scope.revision,
  () => {
    clear()
    sessions.clear()
  },
  { flush: 'sync' },
)
watch(
  () => auth.epoch,
  () => {
    clear()
    sessions.clear()
    sessions.list.value = []
    tools.value = []
  },
)
onScopeDispose(clear)
async function openSession(id: number) {
  sessionListOpen.value = false
  followConversation = true
  clear()
  await sessions.select(id)
  if (sessions.active.value) {
    const selected = sessions.active.value
    const rows = sessions.history.value
    scope.set(selected.scope)
    sessions.active.value = selected
    sessions.history.value = rows
  }
}
async function newSession() {
  followConversation = true
  clear()
  sessions.clear()
  await sessions.create()
  if (sessions.active.value) sessionListOpen.value = false
}
async function refreshSession() {
  clear()
  await sessions.sync()
}
function singleRound() {
  sessionListOpen.value = false
  followConversation = true
  clear()
  sessions.clear()
}
async function removeSession() {
  clear()
  await sessions.remove()
}
async function ask() {
  if (sending.value || sessions.busy.value || !question.value.trim()) return
  followConversation = true
  const current = ++generation,
    prompt = question.value
  const frozen = { ...scope.scope, knowledgeBaseIds: [...scope.scope.knowledgeBaseIds] }
  const session = sessions.active.value
  const options: ChatOptions = {
    modelProfile: modelProfile.value,
    responseFormat: responseFormat.value,
    toolMode: toolMode.value,
    ...(session ? { sessionId: session.id, sessionVersion: session.version } : {}),
  }
  controller = new AbortController()
  sending.value = true
  const message: Message = {
    id: crypto.randomUUID(),
    question: prompt,
    answer: '',
    citations: [],
    result: null,
    stage: '正在处理',
    error: '',
    historyCursor: sessions.history.value.at(-1)?.seq ?? 0,
  }
  messages.value = session ? [message] : [...messages.value.slice(-19), message]
  const entry = messages.value[messages.value.length - 1]!
  const update = (text: string, citations: EvidenceBundle[], stage: string) => {
    if (current !== generation) return
    pending = () => {
      if (current === generation) {
        entry.answer = text
        entry.citations = citations
        entry.stage = stage
      }
    }
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        pending?.()
        pending = null
      })
  }
  try {
    const result = streaming.value
      ? await chatApi.stream(prompt, frozen, controller.signal, update, options)
      : await chatApi.ask(prompt, frozen, controller.signal, options)
    if (current !== generation) return
    cancelAnimationFrame(frame)
    frame = 0
    pending = null
    entry.answer = result.answer
    entry.citations = result.citations
    entry.result = result
    entry.stage = '完整交付'
    question.value = ''
    if (session) {
      if (result.sessionId !== session.id || !result.sessionVersion)
        throw new Error('会话响应缺少有效版本，请核对服务端历史')
      sessions.active.value = { ...session, version: result.sessionVersion }
      await sessions.sync()
      if (sessions.error.value)
        entry.error = '回答已交付，但历史暂不可获取：' + sessions.error.value
    }
  } catch (e) {
    if (current !== generation) return
    pending?.()
    cancelAnimationFrame(frame)
    frame = 0
    pending = null
    entry.stage = isAbort(e) ? '已停止阅读 / 等待超时，结果需核对' : '本次未完整交付'
    entry.error = isAbort(e) ? '停止阅读不保证取消已经发出的模型请求。' : errorMessage(e)
    entry.result = null
    if (session) {
      entry.answer = ''
      entry.citations = []
      await sessions.sync()
      if (current !== generation) return
      entry.error += sessions.error.value
        ? ' 会话核对失败：' + sessions.error.value
        : ' 已重新读取会话版本与历史，请先核对已保存事实。'
    }
    if (e instanceof ApiError && e.status === 403) {
      messages.value = []
      source.value = null
      error.value = errorMessage(e)
    }
  } finally {
    if (current === generation) sending.value = false
  }
}
function prepareNote(message: Message) {
  if (!message.result || message.result.status !== 'SUCCESS' || !message.result.citations.length)
    return
  noteResult.value = message.result
  noteTitle.value = message.question.slice(0, 200)
  noteText.value = message.result.answer
  target.value = null
  noteOpen.value = true
}
function prepare() {
  void run(async () => {
    if (!noteResult.value) return
    const approval = await chatApi.prepare(
      positiveId(target.value),
      noteTitle.value,
      noteText.value,
      dependenciesFrom(noteResult.value.citations),
      noteRequests.signal,
    )
    noteOpen.value = false
    await router.push('/approvals/' + encodeURIComponent(approval.approvalId))
  })
}
</script>
<template>
  <div class="chat-workspace">
    <aside v-if="!compact" class="conversation-sidebar" aria-label="本人会话">
      <ChatSessionList
        :sessions="sessions"
        :sending="sending"
        @title="sessions.title.value = $event"
        @open="openSession"
        @create="newSession"
        @single="singleRound"
        @refresh="refreshSession"
        @remove="removeSession"
      />
    </aside>
    <section class="conversation-pane" aria-label="当前会话">
      <header class="conversation-header">
        <div class="conversation-heading">
          <el-button
            v-if="compact"
            text
            :icon="ChatDotRound"
            aria-label="打开会话列表"
            :aria-expanded="sessionListOpen"
            @click="sessionListOpen = true"
          />
          <div>
            <span class="eyebrow">KNOWLEDGE CHAT</span>
            <h1>{{ conversationTitle }}</h1>
          </div>
        </div>
        <div class="conversation-header-actions">
          <span class="conversation-model"
            >{{ modelProfile ? modelLabel : '自动选择' }} · {{ scopeLabel }}</span
          >
          <el-button :icon="Setting" :aria-expanded="settingsOpen" @click="settingsOpen = true"
            >会话设置</el-button
          >
        </div>
      </header>
      <div
        ref="thread"
        class="conversation-thread"
        tabindex="0"
        aria-label="聊天内容"
        @scroll="trackScroll"
      >
        <Feedback :error="error || sessions.error.value" />
        <section v-if="sessions.active.value" class="session-history">
          <div class="history-heading">
            <span>服务端历史</span><span>版本 {{ sessions.active.value.version }}</span>
          </div>
          <article
            v-for="event in displayedHistory"
            :key="event.seq"
            class="structure-row history-message"
            :class="{ 'history-message-user': event.role === 'USER' }"
          >
            <span class="muted small"
              >#{{ event.seq }} · {{ event.role }} · {{ event.status }}
              <span v-if="event.toolName">· {{ event.toolName }}</span></span
            >
            <p v-if="event.status === 'RESTRICTED'">历史内容当前不可访问</p>
            <MarkdownView v-else-if="event.content" :text="event.content" />
            <template v-if="event.status !== 'RESTRICTED'">
              <RouterLink
                v-for="reference in event.sourceReferences"
                :key="reference.dependency.documentId + ':' + reference.sectionId"
                :to="'/documents/' + reference.dependency.documentId"
                >来源 #{{ reference.dependency.documentId }} · v{{
                  reference.dependency.documentVersion
                }}（历史版本，仅打开当前文档）</RouterLink
              >
            </template>
          </article>
          <el-button :disabled="sending || sessions.busy.value" @click="sessions.more"
            >读取后续历史</el-button
          >
        </section>
        <section v-if="!messages.length && !sessions.history.value.length" class="chat-welcome">
          <div class="welcome-symbol">
            <el-icon aria-hidden="true"><MagicStick /></el-icon>
          </div>
          <h2>你的资料里，藏着哪些答案？</h2>
          <p class="muted">从一个问题开始。回答会附上后端提供的证据，方便回到原文核对。</p>
          <div class="suggestion-grid">
            <button
              v-for="(suggestion, i) in suggestions"
              :key="suggestion"
              class="suggestion-card"
              @click="question = suggestion"
            >
              <el-icon
                ><component :is="i === 0 ? Collection : i === 1 ? Document : Promotion" /></el-icon
              ><span>{{ suggestion }}</span
              ><span class="suggestion-arrow">↗</span>
            </button>
          </div>
          <div class="welcome-foot"><span class="live-dot" /> 当前范围 · {{ scopeLabel }}</div>
        </section>
        <div v-if="messages.length" class="chat-messages">
          <article v-for="message in messages" :key="message.id" class="chat-exchange">
            <div class="user-question">
              <span class="question-avatar">你</span>
              <p>{{ message.question }}</p>
            </div>
            <div class="assistant-answer">
              <span class="answer-avatar">N·</span>
              <div class="answer-content">
                <div class="answer-meta">
                  <strong>Novid</strong><span class="muted small">{{ message.stage }}</span
                  ><StatusBadge v-if="message.result" :status="message.result.status" />
                </div>
                <MarkdownView v-if="message.answer" :text="message.answer" />
                <p v-else class="muted">{{ message.stage }}…</p>
                <Feedback :error="message.error" />
                <div v-if="message.citations.length" class="citations">
                  <button
                    v-for="citation in message.citations"
                    :key="citation.evidenceId"
                    @click="source = citation"
                  >
                    <span>{{ citation.evidenceId }}</span
                    >{{ citation.document.title
                    }}<small>v{{ citation.document.documentVersion }} ↗</small>
                  </button>
                </div>
                <div v-if="message.result" class="answer-footer">
                  <span class="muted small"
                    >模型标识 {{ message.result.modelId }} · 尝试
                    {{ message.result.modelAttempts }} 次
                    <b v-if="message.result.mock">· 测试结果</b></span
                  >
                  <div class="toolbar">
                    <RouterLink
                      v-if="message.result.traceId"
                      :to="'/runs/' + encodeURIComponent(message.result.traceId)"
                      >运行检查</RouterLink
                    ><el-button
                      v-if="message.result.status === 'SUCCESS' && message.result.citations.length"
                      text
                      type="primary"
                      @click="prepareNote(message)"
                      >准备保存笔记 →</el-button
                    >
                  </div>
                </div>
                <p v-if="message.result?.error" class="inline-error">{{ message.result.error }}</p>
                <details v-if="message.result?.route" class="route-details">
                  <summary>本次模型选择与尝试</summary>
                  <p>
                    {{ message.result.route.profile }} · {{ message.result.route.routingMode }} ·
                    {{ message.result.route.selectedModelId }}
                  </p>
                  <p>{{ message.result.route.selectionReason }}</p>
                  <p class="muted small">
                    质量配置
                    {{ message.result.route.qualityVersion }}；配置版本不代表质量验收。费用未知。
                  </p>
                  <p v-for="(attempt, index) in message.result.route.attempts" :key="index">
                    {{ attempt.modelId }} · {{ attempt.outcome }} · 输入
                    {{ attempt.inputTokens ?? '未知' }} / 输出
                    {{ attempt.outputTokens ?? '未知' }} ·
                    {{ attempt.usageSource }}
                  </p>
                </details>
              </div>
            </div>
          </article>
          <div class="toolbar">
            <el-button text :disabled="sending" @click="clear">清空本页问答</el-button
            ><span class="muted small">最多保留本页最近 20 次问题。</span>
          </div>
        </div>
      </div>
      <form class="chat-composer" @submit.prevent="ask">
        <el-input
          v-model="question"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          maxlength="2000"
          aria-label="你的问题"
          placeholder="写下问题，记得补充必要的背景…"
          :disabled="sending"
        />
        <div class="composer-footer">
          <span class="muted small">{{ scopeLabel }} · {{ question.length }}/2000</span>
          <div class="toolbar">
            <el-button v-if="sending" :icon="Close" @click="controller?.abort()">停止阅读</el-button
            ><el-button
              v-else
              type="primary"
              native-type="submit"
              :icon="Promotion"
              :disabled="!question.trim() || sessions.busy.value"
              >发送问题</el-button
            >
          </div>
        </div>
      </form>
    </section>
  </div>
  <el-drawer
    v-model="sessionListOpen"
    direction="ltr"
    size="min(300px, 88vw)"
    title="会话列表"
    :with-header="false"
    destroy-on-close
    class="conversation-list-drawer"
  >
    <el-button
      class="conversation-list-close"
      text
      :icon="Close"
      aria-label="关闭会话列表"
      @click="sessionListOpen = false"
    />
    <ChatSessionList
      v-if="compact"
      :sessions="sessions"
      :sending="sending"
      @title="sessions.title.value = $event"
      @open="openSession"
      @create="newSession"
      @single="singleRound"
      @refresh="refreshSession"
      @remove="removeSession"
    />
  </el-drawer>
  <el-drawer
    v-model="settingsOpen"
    title="会话设置"
    size="min(420px, 100vw)"
    class="conversation-settings-drawer"
  >
    <p class="settings-intro">{{ conversationTitle }} · 设置用于接下来发送的问题。</p>
    <h3>模型与输出</h3>
    <div class="toolbar chat-options">
      <label
        >模型配置
        <select v-model="modelProfile" aria-label="模型配置" :disabled="sending">
          <option :value="undefined">自动选择</option>
          <option value="knowledge">知识问答</option>
          <option value="economy">经济</option>
          <option value="analysis">分析</option>
          <option value="report">报告</option>
        </select></label
      >
      <label
        >回答格式
        <select
          v-model="responseFormat"
          aria-label="回答格式"
          :disabled="sending || toolMode === 'READ_ONLY'"
        >
          <option value="TEXT">文本</option>
          <option value="STRUCTURED">结构化校验</option>
        </select></label
      >
      <label
        >工具续轮
        <select v-model="toolMode" aria-label="工具续轮" :disabled="sending">
          <option value="OFF">关闭</option>
          <option value="READ_ONLY">只读工具</option>
        </select></label
      >
      <el-button text :disabled="sending || busy" @click="loadTools">查看可用工具</el-button>
    </div>
    <div v-if="toolsLoaded" class="muted small">
      <p v-if="!tools.length">服务端暂无可用工具定义。</p>
      <p v-for="tool in tools" :key="tool.name">
        {{ tool.name }} · {{ tool.description }} · {{ tool.enabled ? '已启用' : '已禁用' }}
      </p>
    </div>
    <div class="settings-section">
      <el-checkbox v-model="streaming" :disabled="sending">流式展示</el-checkbox>
      <p class="muted small">逐步显示回答内容。</p>
    </div>
    <div class="settings-section">
      <h3>读取范围</h3>
      <ScopePicker :admin="auth.user?.role === 'ADMIN'" />
      <p class="muted small">修改范围将清空本页回答并退出当前会话，已保存的会话历史保留。</p>
    </div>
    <el-button type="primary" class="settings-done" @click="settingsOpen = false"
      >完成设置</el-button
    >
  </el-drawer>
  <SourceDrawer :evidence="source" @close="source = null" /><el-dialog
    v-model="noteOpen"
    title="准备笔记 · 下一步核对并确认"
    width="min(760px, 96vw)"
    ><Feedback :error="error" /><el-form label-position="top" @submit.prevent="prepare"
      ><el-form-item label="保存到本人知识库"><OwnBaseSelect v-model="target" /></el-form-item
      ><el-form-item label="标题"><el-input v-model="noteTitle" maxlength="200" /></el-form-item
      ><el-form-item label="笔记内容"
        ><el-input v-model="noteText" type="textarea" :rows="10"
      /></el-form-item>
      <p class="muted small">
        保留回答全部证据来源，服务端将重新核验并展开依赖。准备完成尚未保存为文档。
      </p>
      <el-button type="primary" native-type="submit" :loading="busy"
        >准备并预览确认 →</el-button
      ></el-form
    ></el-dialog
  >
</template>
