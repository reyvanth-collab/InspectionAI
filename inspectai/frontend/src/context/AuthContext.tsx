import {
  createContext, useContext, useState, useEffect,
  useCallback, type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

interface AuthContextValue {
  user: User | null
  session: Session | null
  isAuthenticated: boolean
  isLoading: boolean           // true while session is being restored on mount
  theme: 'dark' | 'light'
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  toggleTheme: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Fetch the public.users profile row for an auth user id.
async function fetchProfile(authId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, tenant_id, staff_id, name, email, role, avatar_url')
    .eq('id', authId)
    .single()

  if (error || !data) return null

  const nameParts = (data.name as string).split(' ')
  const initials  = nameParts.map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

  return {
    id:             data.id as string,
    tenantId:       data.tenant_id as string,
    staffId:        data.staff_id as string,
    name:           data.name as string,
    email:          data.email as string,
    role:           data.role as User['role'],
    avatarInitials: initials,
    avatarUrl:      data.avatar_url as string | undefined,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setLoading] = useState(true)
  const [theme, setTheme]     = useState<'dark' | 'light'>('dark')

  // ── Restore session on mount ────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        setUser(profile)
      }
      setLoading(false)
    })

    // Listen for sign-in / sign-out / token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session?.user) {
          const profile = await fetchProfile(session.user.id)
          if (profile) {
            setUser(profile)
          } else {
            const emailPrefix = session.user.email?.split('@')[0] ?? 'user'
            setUser({
              id:             session.user.id,
              tenantId:       '',
              staffId:        '',
              name:           session.user.user_metadata?.name ?? emailPrefix,
              email:          session.user.email ?? '',
              role:           (session.user.user_metadata?.role as User['role']) ?? 'inspector',
              avatarInitials: emailPrefix.slice(0, 2).toUpperCase(),
            })
          }
        } else {
          setUser(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // ── Login ───────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)

    if (data.user) {
      const profile = await fetchProfile(data.user.id)
      if (profile) {
        setUser(profile)
      } else {
        // Profile row missing (RLS or trigger issue) — build a fallback from auth data
        const emailPrefix = data.user.email?.split('@')[0] ?? 'user'
        setUser({
          id:             data.user.id,
          tenantId:       '',
          staffId:        '',
          name:           data.user.user_metadata?.name ?? emailPrefix,
          email:          data.user.email ?? '',
          role:           (data.user.user_metadata?.role as User['role']) ?? 'inspector',
          avatarInitials: emailPrefix.slice(0, 2).toUpperCase(),
        })
      }
    }
  }, [])

  // ── Logout ──────────────────────────────────────────────────
  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }, [])

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
      user, session,
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
