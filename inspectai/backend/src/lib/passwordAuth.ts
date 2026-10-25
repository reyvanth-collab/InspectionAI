import { createClient } from '@supabase/supabase-js'

// A fresh client per attempt prevents one user's session from being reused by
// another request or replacing the shared administrative storage client.
export async function authenticatePassword(email: string, password: string) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase authentication is not configured')
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) return null
  return data.user.id
}
