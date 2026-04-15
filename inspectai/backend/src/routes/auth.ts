import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()

// GET /api/auth/me — returns the authenticated user's profile.
// The frontend passes the Supabase JWT; middleware verifies it and
// attaches req.user. This endpoint is useful for server-side profile
// lookups and confirms the backend can reach Supabase correctly.
router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ data: req.user })
})

export default router
