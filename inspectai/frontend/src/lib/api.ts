import axios from 'axios'

export const JWT_KEY = 'inspectai-jwt'
export class ApiError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
    public status?: number,
    public retryAfter?: number,
    public issues: Array<{nodeId?:string;edgeId?:string;message:string}> = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach our own backend JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(JWT_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Global error normalisation — 401 clears the stored token
api.interceptors.response.use(
  (res) => {
    const sent = res.config.headers.Authorization
    const current = localStorage.getItem(JWT_KEY)
    if (sent && sent !== `Bearer ${current}`)
      return Promise.reject(new Error('Session changed; response discarded'))
    return res
  },
  (err) => {
    if (
      err.response?.status === 401 &&
      err.config?.headers?.Authorization === `Bearer ${localStorage.getItem(JWT_KEY)}`
    ) {
      localStorage.removeItem(JWT_KEY)
      window.dispatchEvent(new Event('session-expired'))
    }
    const message = err.response?.data?.error ?? err.message ?? 'Unknown error'
    return Promise.reject(
      new ApiError(
        message,
        err.response?.data?.fieldErrors || {},
        err.response?.status,
        Number(err.response?.headers?.['retry-after']) || undefined,
        err.response?.data?.issues || [],
      ),
    )
  },
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
