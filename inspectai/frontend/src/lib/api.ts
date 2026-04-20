import axios from 'axios'

export const JWT_KEY = 'inspectai-jwt'

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach our own backend JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem(JWT_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Global error normalisation — 401 clears the stored token
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) localStorage.removeItem(JWT_KEY)
    const message = err.response?.data?.error ?? err.message ?? 'Unknown error'
    return Promise.reject(new Error(message))
  }
)

/** Decode JWT payload without a library (base64url → JSON). */
export function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}
