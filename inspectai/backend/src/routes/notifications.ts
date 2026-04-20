import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/notifications
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, message, severity, read, created_at
       FROM   public.notifications
       WHERE  tenant_id = $1
       ORDER  BY created_at DESC
       LIMIT  50`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// PATCH /api/notifications/read-all
router.patch('/read-all', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await query(
      `UPDATE public.notifications SET read = true WHERE tenant_id = $1 AND read = false`,
      [req.user!.tenantId]
    )
    res.json({ message: 'All notifications marked as read' })
  } catch (err) { next(err) }
})

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    await query(
      `UPDATE public.notifications SET read = true WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    )
    res.json({ message: 'Notification marked as read' })
  } catch (err) { next(err) }
})

export default router
