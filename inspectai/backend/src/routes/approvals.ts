import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/approvals
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT
         ar.id, ar.wi_id, ar.submitted_by, ar.submitted_at, ar.final_status,
         wi.wi_number, wi.title AS wi_title, wi.revision,
         u_sub.name AS submitted_by_name,
         json_agg(
           json_build_object(
             'id',           s.id,
             'step_number',  s.step_number,
             'label',        s.label,
             'status',       s.status,
             'comment',      s.comment,
             'completed_at', s.completed_at,
             'approver_id',  s.approver_id,
             'approver_name', u_app.name
           ) ORDER BY s.step_number
         ) FILTER (WHERE s.id IS NOT NULL) AS approval_steps
       FROM   public.approval_records ar
       LEFT JOIN public.work_instructions wi   ON wi.id  = ar.wi_id
       LEFT JOIN public.users u_sub            ON u_sub.id = ar.submitted_by
       LEFT JOIN public.approval_steps s       ON s.approval_record_id = ar.id
       LEFT JOIN public.users u_app            ON u_app.id = s.approver_id
       WHERE  ar.tenant_id = $1
       GROUP BY ar.id, wi.wi_number, wi.title, wi.revision, u_sub.name
       ORDER BY ar.submitted_at DESC`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// PATCH /api/approvals/steps/:stepId/approve
router.patch('/steps/:stepId/approve', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { comment } = req.body as { comment?: string }
    await query(
      `UPDATE public.approval_steps
       SET status = 'done', comment = $1, completed_at = NOW()
       WHERE id = $2`,
      [comment || null, req.params.stepId]
    )
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

// PATCH /api/approvals/steps/:stepId/reject
router.patch('/steps/:stepId/reject', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { comment } = req.body as { comment: string }
    await query(
      `UPDATE public.approval_steps
       SET status = 'rejected', comment = $1
       WHERE id = $2`,
      [comment, req.params.stepId]
    )
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

export default router
