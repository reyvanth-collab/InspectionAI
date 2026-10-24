import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
export default function ResetPassword() {
 const [ready, setReady] = useState(false), [password, setPassword] = useState(''), [message, setMessage] = useState('Verifying recovery link…')
 useEffect(() => { void supabase.auth.getSession().then(({ data }) => { setReady(!!data.session); setMessage(data.session ? '' : 'Recovery link is invalid or expired. Request a new link.') }); const { data } = supabase.auth.onAuthStateChange((event, session) => { if (event === 'PASSWORD_RECOVERY' && session) { setReady(true); setMessage('') } }); return () => data.subscription.unsubscribe() }, [])
 const submit = async (e: FormEvent) => { e.preventDefault(); if (password.length < 12) { setMessage('Use at least 12 characters'); return } const { error } = await supabase.auth.updateUser({ password }); if (error) { setMessage(error.message); return } await supabase.auth.signOut(); localStorage.removeItem('inspectai-jwt'); window.location.assign('/login') }
 return <main className="max-w-md mx-auto p-8"><h1>Reset password</h1><p role="status">{message}</p>{ready && <form onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></label><button type="submit">Set password</button></form>}<a href="/login">Back to sign in</a></main>
}
