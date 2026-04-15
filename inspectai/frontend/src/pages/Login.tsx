import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'

type Mode = 'login' | 'forgot'

export default function Login() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [mode,     setMode]     = useState<Mode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState('')

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) { setError('Enter your email address first'); return }
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw new Error(error.message)
      setSuccess(`Password reset email sent to ${email}. Check your inbox.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-bg flex items-center justify-center">
      <div className="w-full max-w-[380px] px-6">

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <div className="w-9 h-9 rounded-[8px] bg-accent flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L2 4v6l5 3 5-3V4L7 1z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="7" cy="7" r="2" fill="white"/>
            </svg>
          </div>
          <span className="text-[18px] font-semibold tracking-[-0.3px]">
            Inspect<span className="text-accent">AI</span>
          </span>
        </div>

        {/* Status badge */}
        <div className="inline-flex items-center gap-1.5 bg-success-bg border border-success-border text-success text-[11px] px-[10px] py-1 rounded-full mb-7">
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-dot" />
          All systems operational
        </div>

        {mode === 'login' ? (
          <>
            <h1 className="text-[26px] font-semibold tracking-[-0.5px] mb-1.5">Welcome back</h1>
            <p className="text-[14px] text-text-2 mb-9">Sign in to your inspection platform</p>

            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div>
                <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  className="w-full px-[14px] py-[10px] bg-bg-2 border border-border-2 rounded-[8px] text-text text-[14px] outline-none focus:border-accent placeholder:text-text-3 transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em]">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(''); setSuccess('') }}
                    className="text-[11px] text-accent hover:underline bg-transparent border-none cursor-pointer p-0"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full px-[14px] py-[10px] bg-bg-2 border border-border-2 rounded-[8px] text-text text-[14px] outline-none focus:border-accent placeholder:text-text-3 transition-colors"
                />
              </div>

              {error && (
                <div className="text-[13px] text-danger bg-danger-bg border border-danger-border rounded-[6px] px-3 py-2">
                  {error}
                  {error.toLowerCase().includes('fetch') && (
                    <p className="mt-1 text-[11px] opacity-80">
                      Tip: check your Supabase RLS policies or network connection.
                    </p>
                  )}
                </div>
              )}

              <Button variant="primary" size="lg" loading={loading} type="submit" className="mt-2">
                Sign in
              </Button>
            </form>

            {/* Demo credentials */}
            <div className="mt-8 p-3 bg-bg-3 border border-border rounded-[8px]">
              <p className="text-[11px] font-medium text-text-2 uppercase tracking-[0.06em] mb-2">Demo credentials</p>
              <div className="flex flex-col gap-1">
                {[
                  { email: 'admin@smrt.com.sg',     pass: 'Admin@1234',     role: 'admin'     },
                  { email: 'james.tan@smrt.com.sg', pass: 'Inspector@1234', role: 'inspector' },
                  { email: 'sarah.lee@smrt.com.sg', pass: 'Approver@1234',  role: 'approver'  },
                ].map(u => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => { setEmail(u.email); setPassword(u.pass) }}
                    className="text-left text-[11px] font-mono text-text-3 hover:text-accent transition-colors bg-transparent border-none cursor-pointer p-0"
                  >
                    {u.email} <span className="text-text-3">({u.role})</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-semibold tracking-[-0.5px] mb-1.5">Reset password</h1>
            <p className="text-[14px] text-text-2 mb-9">
              Enter your email and we'll send you a reset link.
            </p>

            {success ? (
              <div className="text-[13px] text-success bg-success-bg border border-success-border rounded-[8px] px-4 py-3 mb-4">
                {success}
              </div>
            ) : (
              <form onSubmit={handleForgot} className="flex flex-col gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoComplete="email"
                    className="w-full px-[14px] py-[10px] bg-bg-2 border border-border-2 rounded-[8px] text-text text-[14px] outline-none focus:border-accent placeholder:text-text-3 transition-colors"
                  />
                </div>

                {error && (
                  <div className="text-[13px] text-danger bg-danger-bg border border-danger-border rounded-[6px] px-3 py-2">
                    {error}
                  </div>
                )}

                <Button variant="primary" size="lg" loading={loading} type="submit" className="mt-2">
                  Send reset link
                </Button>
              </form>
            )}

            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
              className="mt-6 text-[12px] text-text-3 hover:text-accent bg-transparent border-none cursor-pointer transition-colors"
            >
              ← Back to sign in
            </button>
          </>
        )}
      </div>
    </div>
  )
}
