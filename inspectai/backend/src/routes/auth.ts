import { Router } from 'express'
import { authenticatePassword } from '../lib/passwordAuth'
import { z } from 'zod'
import { query } from '../lib/db'
import { signToken } from '../lib/jwt'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { auditLog } from '../lib/events'
import { createRateLimiter } from '../middleware/rateLimit'

const router = Router()
const loginRateLimit = createRateLimiter(10, 15 * 60 * 1000)

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// POST /api/auth/login
router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }
    const { email, password } = parsed.data

    const authenticatedId = await authenticatePassword(email, password)
    if (!authenticatedId) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    // The private server-only view exposes a password-change fingerprint,
    // never a password hash. Authorization stays in the application profile.
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.staff_id, u.tenant_id,
              av.auth_version, u.capabilities, u.primary_department_id,
              (SELECT t.name FROM public.tenants t WHERE t.id=u.tenant_id) AS tenant_name
       FROM public.users u
       JOIN inspectai_private.session_versions av ON av.id = u.id
       WHERE u.id = $1
         AND u.active = true
       LIMIT 1`,
      [authenticatedId],
    )

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const user = result.rows[0]

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      staffId: user.staff_id,
      tenantId: user.tenant_id,
      name: user.name,
      authVersion: user.auth_version,
    })

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        staffId: user.staff_id,
        tenantId: user.tenant_id,
        tenantName: user.tenant_name,
        capabilities: user.capabilities,
        primaryDepartmentId: user.primary_department_id,
      },
    })

    await auditLog({
      tenantId: user.tenant_id,
      userId: user.id,
      action: 'auth.login',
      entityType: 'users',
      entityId: user.id,
      detail: { email: user.email },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me — returns decoded JWT payload
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ data: req.user })
})

export default router
