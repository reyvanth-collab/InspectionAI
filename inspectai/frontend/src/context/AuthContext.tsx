import {
  createContext, useContext, useState, useEffect,
  useCallback, type ReactNode,
} from 'react'
import { api, JWT_KEY, decodeJWT } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import type { User } from '@/types'

interface AuthContextValue {
  user:            User | null
  isAuthenticated: boolean
  isLoading:       boolean
  theme:           'dark' | 'light'
  login:           (email: string, password: string) => Promise<void>
  logout:          () => void
  toggleTheme:     () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isTokenExpired(token: string): boolean {
  const p = decodeJWT(token)
  if (!p?.exp) return true
  return (p.exp as number) * 1000 < Date.now()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,      setUser]    = useState<User | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [theme,     setTheme]   = useState<'dark' | 'light'>('dark')

  // ── Restore session from localStorage on mount ──────────────
  useEffect(() => {
    const token = localStorage.getItem(JWT_KEY)
    if (token && !isTokenExpired(token)) {
      // Only the backend can validate the token and current account privileges.
      let current = true
      void api.get<{ data: User }>('/auth/me').then(({ data }) => {
        if (current && localStorage.getItem(JWT_KEY) === token) {
          const profile = data.data
          setUser({ ...profile, avatarInitials: profile.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase() })
        }
      }).catch(() => {
        if (current && localStorage.getItem(JWT_KEY) === token) localStorage.removeItem(JWT_KEY)
      }).finally(() => { if (current) setLoading(false) })
      return () => { current = false }
    } else {
      localStorage.removeItem(JWT_KEY)
    }
    setLoading(false)
  }, [])

  // ── Login — POST /api/auth/login ────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    await queryClient.cancelQueries()
    queryClient.clear()
    const res = await api.post<{
      token: string
      user: { id: string; name: string; email: string; role: string; staffId: string; tenantId: string }
    }>('/auth/login', { email, password })

    const { token, user: userData } = res.data
    localStorage.setItem(JWT_KEY, token)

    const name = userData.name ?? email.split('@')[0]
    setUser({
      id:             userData.id,
      tenantId:       userData.tenantId ?? '',
      staffId:        userData.staffId  ?? '',
      name,
      email:          userData.email,
      role:           userData.role as User['role'],
      avatarInitials: name.split(' ').map((s: string) => s[0]).join('').slice(0, 2).toUpperCase(),
    })
  }, [])

  // ── Logout ──────────────────────────────────────────────────
  const logout = useCallback(() => {
    void queryClient.cancelQueries()
    queryClient.clear()
    localStorage.removeItem(JWT_KEY)
    setUser(null)
  }, [])

  useEffect(() => { const expired = () => logout(); window.addEventListener('session-expired', expired); return () => window.removeEventListener('session-expired', expired) }, [logout])

  // ── Theme ───────────────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('light', next === 'light')
      return next
    })
  }, [])

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      theme,
      login, logout, toggleTheme,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
