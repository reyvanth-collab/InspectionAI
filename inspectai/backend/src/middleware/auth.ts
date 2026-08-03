import type { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'
import { query } from '../lib/db'

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
      `SELECT id, email, name, role, staff_id, tenant_id
       FROM public.users
       WHERE id = $1 AND tenant_id = $2 AND active = true
       LIMIT 1`,
      [claims.id, claims.tenantId]
    )
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Account is inactive or no longer available' })
      return
    }
    const user = result.rows[0]
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      staffId: user.staff_id,
      tenantId: user.tenant_id,
    }
    next()
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
    next()
  }
}
