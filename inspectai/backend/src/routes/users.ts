import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
import { auditLog } from '../lib/events'

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
         AND  active = true
         AND  lower(role::text) IN ('admin', 'approver')
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
         AND  active = true
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
    const allowedRoles = new Set(['admin', 'approver', 'inspector', 'viewer'])
    if (!allowedRoles.has(role)) {
      res.status(400).json({ error: 'Invalid role' }); return
    }
    const result = await query(
      `UPDATE public.users SET role = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, email, role`,
      [role, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'User not found' }); return }
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'user.role.updated',
      entityType: 'users',
      entityId: req.params.id,
      detail: { email: result.rows[0].email, role },
    })
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

export default router
