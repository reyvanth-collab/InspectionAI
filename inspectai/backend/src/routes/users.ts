import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/users — all users in tenant (admin only)
router.get('/', requireAuth, requireRole('admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, staff_id, role
       FROM   public.users
       WHERE  tenant_id = $1
       ORDER  BY name`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/users/approvers — users who can approve (admin + approver roles)
router.get('/approvers', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, staff_id, role
       FROM   public.users
       WHERE  tenant_id = $1
         AND  lower(role) IN ('admin', 'approver')
       ORDER  BY name`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/users/assignable — all users that can be assigned to work orders
router.get('/assignable', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, staff_id, role
       FROM   public.users
       WHERE  tenant_id = $1
       ORDER  BY name`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// PATCH /api/users/:id/role — update a user's role (admin only)
router.patch('/:id/role', requireAuth, requireRole('admin'), async (req: AuthRequest, res, next) => {
  try {
    const { role } = req.body as { role: string }
    await query(
      `UPDATE public.users SET role = $1 WHERE id = $2 AND tenant_id = $3`,
      [role, req.params.id, req.user!.tenantId]
    )
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

export default router
