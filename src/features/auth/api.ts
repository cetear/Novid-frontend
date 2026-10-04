import { http } from '@/shared/api/transport'
import { loginSchema, userSchema } from '@/shared/api/contracts/backend'
import { validPassword, validUsername } from '@/shared/lib/validation'
export const authApi = {
  login(username: string, password: string) {
    validUsername(username)
    validPassword(password)
    return http().json('/auth/login', loginSchema, {
      method: 'POST',
      auth: 'login',
      json: { username, password },
    })
  },
  me() {
    return http().json('/auth/me', userSchema)
  },
  password(oldPassword: string, newPassword: string) {
    validPassword(oldPassword)
    validPassword(newPassword, true)
    return http().empty('/auth/password', {
      method: 'POST',
      auth: 'password',
      json: { oldPassword, newPassword },
    })
  },
  logout() {
    return http().empty('/auth/logout', { method: 'POST' })
  },
}
