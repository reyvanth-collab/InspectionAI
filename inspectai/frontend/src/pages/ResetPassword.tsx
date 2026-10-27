import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'

export default function ResetPassword() {
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        setReady(true)
        setChecking(false)
        setMessage('')
      } else if (event === 'SIGNED_OUT') {
        setReady(false)
        setMessage('Your recovery session has ended. Request a new link from sign in.')
      }
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      setReady(!error && !!data.session)
      setMessage(!error && data.session ? '' : 'This recovery link is invalid or expired. Request a new link from sign in.')
    }).catch(() => {
      if (active) setMessage('We could not verify this link. Check your connection and reload the page.')
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    if (password.length < 12) { setMessage('Use at least 12 characters.'); return }
    if (password !== confirmation) { setMessage('The passwords do not match.'); return }
    setSaving(true)
    setMessage('')
    let updated = false
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setMessage('The password could not be updated. Use a different password with at least 12 characters, or request a new recovery link.')
        return
      }
      updated = true
      // Clear the app credential even if provider sign-out encounters a network error.
      localStorage.removeItem('inspectai-jwt')
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      if (!updated) setMessage('We could not update your password. Check your connection and try again.')
    } finally {
      setSaving(false)
      if (updated) window.location.replace('/login')
    }
  }
  return <main className="min-h-dvh flex items-center justify-center px-4 py-10">
    <section className="execution-card w-full max-w-md" aria-labelledby="reset-heading">
      <Link to="/login" className="font-semibold text-accent inline-block mb-8">InspectAI</Link>
      <h1 id="reset-heading" className="text-2xl font-semibold mb-3">Set a new password</h1>
      <p className="text-sm text-text-2 mb-6">Choose a unique password with at least 12 characters.</p>
      {checking && <p role="status">Verifying recovery link…</p>}
      {message && <p role="alert" className="text-sm text-danger bg-danger-bg border border-danger-border rounded-lg p-3 mb-4">{message}</p>}
      {ready && !checking && <form onSubmit={submit} className="flex flex-col gap-5">
        <div><label htmlFor="new-password" className="field-label">New password</label>
          <input id="new-password" name="new-password" className="field-input" type="password" autoComplete="new-password" minLength={12} required disabled={saving} value={password} onChange={event => setPassword(event.target.value)} /></div>
        <div><label htmlFor="confirm-password" className="field-label">Confirm new password</label>
          <input id="confirm-password" name="confirm-password" className="field-input" type="password" autoComplete="new-password" minLength={12} required disabled={saving} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
        <Button type="submit" loading={saving}>Set password</Button>
      </form>}
      <Link to="/login" className="inline-block text-sm text-accent mt-6">Back to sign in</Link>
    </section>
  </main>
}
