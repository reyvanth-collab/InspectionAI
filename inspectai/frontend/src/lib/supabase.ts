import { createClient } from '@supabase/supabase-js'

// In development, route all Supabase calls through the Vite proxy (localhost:3000).
// This bypasses any corporate SSL inspection proxy that strips CORS headers.
// In production, the real Supabase URL is used directly.
const supabaseUrl = import.meta.env.DEV
  ? 'http://localhost:3000'
  : (import.meta.env.VITE_SUPABASE_URL as string)

const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
// The application authenticates through the backend JWT. Keep the Supabase
// client constructible locally; production builds still require real values.
const supabaseAnonKey = configuredAnonKey || 'local-development-placeholder'

if (!configuredAnonKey) {
  console.warn('[supabase] VITE_SUPABASE_ANON_KEY not set in frontend/.env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:    true,
    autoRefreshToken:  true,
    detectSessionInUrl: true,
    storageKey: 'inspectai-auth',   // fixed key — won't change if URL changes
  },
})
