import dotenv from 'dotenv'

dotenv.config()

export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return

  const required: Array<[string, string | undefined]> = [
    ['DATABASE_URL', process.env.DATABASE_URL],
    ['FRONTEND_URL', process.env.FRONTEND_URL],
    ['SUPABASE_URL', process.env.SUPABASE_URL],
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
    ['JWT_SECRET', process.env.JWT_SECRET],
  ]
  const missing = required.filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) throw new Error(`Missing production environment variables: ${missing.join(', ')}`)
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production')
  }
  if (process.env.ANTHROPIC_API_KEY?.includes('your-')) {
    throw new Error('ANTHROPIC_API_KEY contains the placeholder value')
  }
}
