import type { Request, Response, NextFunction } from 'express'
import { supabase } from '../lib/supabase'

export interface AuthRequest extends Request {
  user?: {
    id:       string
    email:    string
    role:     string
    staffId:  string
    tenantId: string
  }
}

// Verify the Supabase JWT and attach the user profile to the request.
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  const token = header.slice(7)

  // Verify via Supabase — returns the auth user if the JWT is valid.
  const { data: { user: authUser }, error } = await supabase.auth.getUser(token)
  if (error || !authUser) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  // Fetch profile from public.users to get role, staff_id, tenant_id.
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, staff_id, tenant_id')
    .eq('id', authUser.id)
    .single()

  if (profileError || !profile) {
    res.status(403).json({ error: 'User profile not found' })
    return
  }

  req.user = {
    id:       authUser.id,
    email:    authUser.email ?? '',
    role:     profile.role as string,
    staffId:  profile.staff_id as string,
    tenantId: profile.tenant_id as string,
  }

  next()
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    next()
  }
}
