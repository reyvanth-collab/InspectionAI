import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query } from '../lib/db'
import { signToken } from '../lib/jwt'
import { requireAuth, type AuthRequest } from '../middleware/auth'

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

    // Fetch user + password hash
    const result = await query(
      `SELECT id, name, email, role, staff_id, tenant_id, password_hash
       FROM public.users
       WHERE email = $1
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
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me — returns decoded JWT payload
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ data: req.user })
})

export default router
