import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserSnapshot } from '@/shared/api/contracts/backend'
import { authApi } from './api'
export const useAuth = defineStore('auth', () => {
  const token = ref<string | null>(null),
    expiresAt = ref(''),
    user = ref<UserSnapshot | null>(null),
    epoch = ref(0)
  let clearPrivate: () => void = () => {}
  function onReset(callback: () => void) {
    clearPrivate = callback
  }
  function reset() {
    epoch.value++
    token.value = null
    user.value = null
    expiresAt.value = ''
    clearPrivate()
  }
  async function login(username: string, password: string) {
    reset()
    const result = await authApi.login(username, password)
    token.value = result.token
    expiresAt.value = result.expiresAt
    user.value = result.user
    try {
      user.value = await authApi.me()
    } catch (e) {
      reset()
      throw e
    }
  }
  return { token, expiresAt, user, epoch, onReset, reset, login }
})
