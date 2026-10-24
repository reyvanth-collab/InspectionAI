import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'
import { query } from '../lib/db'
import { actorContext } from '../lib/actor'

export interface AuthRequest extends Request {
  user?: {
    id:       string
    email:    string
    role:     string
    staffId:  string
    tenantId: string
    name:     string
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }
  const token = header.slice(7)
  try {
    const claims = verifyToken(token)
    const result = await query(
      `SELECT u.id, u.email, u.name, u.role, u.staff_id, u.tenant_id, au.encrypted_password
       FROM public.users u JOIN auth.users au ON au.id = u.id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.active = true
       LIMIT 1`,
      [claims.id, claims.tenantId]
    )
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Account is inactive or no longer available' })
      return
    }
    const user = result.rows[0]
    if (claims.authVersion !== crypto.createHash('sha256').update(user.encrypted_password).digest('hex')) { res.status(401).json({ error: 'Credentials changed; sign in again' }); return }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      staffId: user.staff_id,
      tenantId: user.tenant_id,
    }
    actorContext.run(req.user!.id, next)
  } catch {
    res.status(401).json({ error: 'Invalid or expired token — please log in again' })
  }
}

export function requireRole(...roles: string[]) {
  const lower = roles.map(r => r.toLowerCase())
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !lower.includes(req.user.role.toLowerCase())) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }
    actorContext.run(req.user!.id, next)
  }
}
