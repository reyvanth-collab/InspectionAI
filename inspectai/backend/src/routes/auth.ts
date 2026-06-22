import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../lib/db'
import { signToken } from '../lib/jwt'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { auditLog } from '../lib/events'

const router = Router()

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }
    const { email, password } = parsed.data

    // Fetch user profile + Supabase-auth password hash. The app still issues
    // its own JWT, but the checked-in schema stores credentials in auth.users.
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.staff_id, u.tenant_id,
              au.encrypted_password AS password_hash
       FROM public.users u
       JOIN auth.users au ON au.id = u.id
       WHERE lower(u.email) = lower($1)
         AND u.active = true
       LIMIT 1`,
      [email]
    )

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const user = result.rows[0]

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    const token = signToken({
      id:       user.id,
      email:    user.email,
      role:     user.role,
      staffId:  user.staff_id,
      tenantId: user.tenant_id,
      name:     user.name,
    })

    res.json({
      token,
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        staffId:  user.staff_id,
        tenantId: user.tenant_id,
      },
    })

    await auditLog({
      tenantId: user.tenant_id,
      userId:   user.id,
      action:   'auth.login',
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
