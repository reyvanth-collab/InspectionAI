import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { pool, query } from '../lib/db'
import { auditLog, createNotification } from '../lib/events'

const router = Router()

// GET /api/approvals
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT
         ar.id,
         ar.work_instruction_id AS wi_id,
         ar.submitted_by,
         ar.submitted_at,
         ar.current_step,
         ar.final_status,
         wi.wi_number,
         wi.title AS wi_title,
         wi.revision,
         u_sub.name AS submitted_by_name,
         COALESCE(
           json_agg(
             json_build_object(
               'id',            s.id,
               'step_number',   s.step_number,
               'label',         s.label,
               'status',        s.status,
               'comment',       s.comment,
               'completed_at',  s.completed_at,
               'approver_id',   s.approver_id,
               'approver_name', u_app.name
             ) ORDER BY s.step_number
           ) FILTER (WHERE s.id IS NOT NULL),
           '[]'::json
         ) AS approval_steps
       FROM   public.approval_records ar
       JOIN   public.work_instructions wi ON wi.id = ar.work_instruction_id
       LEFT JOIN public.users u_sub       ON u_sub.id = ar.submitted_by
       LEFT JOIN public.approval_steps s  ON s.approval_record_id = ar.id
       LEFT JOIN public.users u_app       ON u_app.id = s.approver_id
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
  const client = await pool.connect()
  try {
    const { comment } = req.body as { comment?: string }
    await client.query('BEGIN')

    const stepRes = await client.query(
      `SELECT s.*, ar.work_instruction_id, ar.submitted_by, ar.final_status,
              wi.wi_number, wi.title AS wi_title, wi.revision
       FROM public.approval_steps s
       JOIN public.approval_records ar ON ar.id = s.approval_record_id
       JOIN public.work_instructions wi ON wi.id = ar.work_instruction_id
       WHERE s.id = $1
         AND s.tenant_id = $2
         AND ar.tenant_id = $2
         AND wi.tenant_id = $2
       FOR UPDATE`,
      [req.params.stepId, req.user!.tenantId]
    )
    if (stepRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Approval step not found' }); return
    }

    const step = stepRes.rows[0]
    if (step.status !== 'active') {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Only the active approval step can be approved' }); return
    }
    if (req.user!.role !== 'admin' && step.approver_id !== req.user!.id) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'This approval step is assigned to another approver' }); return
    }

    await client.query(
      `UPDATE public.approval_steps
       SET status = 'done', comment = $1, completed_at = NOW()
       WHERE id = $2`,
      [comment || null, req.params.stepId]
    )

    const nextRes = await client.query(
      `SELECT id, step_number, approver_id
       FROM public.approval_steps
       WHERE approval_record_id = $1 AND status = 'wait'
       ORDER BY step_number ASC
       LIMIT 1`,
      [step.approval_record_id]
    )

    let finalStatus: 'active' | 'done' = 'active'
    let nextApproverId: string | null = null

    if (nextRes.rows.length > 0) {
      const nextStep = nextRes.rows[0]
      nextApproverId = nextStep.approver_id
      await client.query(
        `UPDATE public.approval_steps SET status = 'active' WHERE id = $1`,
        [nextStep.id]
      )
      await client.query(
        `UPDATE public.approval_records
         SET current_step = $1, updated_at = NOW()
         WHERE id = $2`,
        [nextStep.step_number, step.approval_record_id]
      )
    } else {
      finalStatus = 'done'
      await client.query(
        `UPDATE public.approval_records
         SET final_status = 'done', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [step.approval_record_id]
      )
      await client.query(
        `UPDATE public.work_instructions
         SET status = 'active',
             effective_date = COALESCE(effective_date, CURRENT_DATE),
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [step.work_instruction_id, req.user!.tenantId]
      )
      await client.query(
        `INSERT INTO public.wi_revision_history
           (tenant_id, work_instruction_id, revision, change_summary, approved_by, effective_date)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE)`,
        [
          req.user!.tenantId,
          step.work_instruction_id,
          step.revision,
          'Approved through InspectAI approval workflow',
          req.user!.id,
        ]
      )
    }

    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: finalStatus === 'done' ? 'wi.approved' : 'approval.step.approved',
      entityType: 'approval_records',
      entityId: step.approval_record_id,
      detail: { wi_number: step.wi_number, step_number: step.step_number },
    })

    if (nextApproverId) {
      await createNotification({
        tenantId: req.user!.tenantId,
        userId: nextApproverId,
        title: `Approval Required - ${step.wi_number}`,
        message: `${step.wi_title} ${step.revision} is ready for your approval.`,
        severity: 'info',
        entityType: 'approval_records',
        entityId: step.approval_record_id,
      })
    } else {
      await createNotification({
        tenantId: req.user!.tenantId,
        userId: step.submitted_by,
        title: `Work Instruction Approved - ${step.wi_number}`,
        message: `${step.wi_title} ${step.revision} has completed approval and is now active.`,
        severity: 'success',
        entityType: 'work_instructions',
        entityId: step.work_instruction_id,
      })
    }

    res.json({ data: { success: true, finalStatus } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// PATCH /api/approvals/steps/:stepId/reject
router.patch('/steps/:stepId/reject', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { comment } = req.body as { comment?: string }
    if (!comment?.trim()) {
      res.status(400).json({ error: 'A rejection comment is required' }); return
    }

    await client.query('BEGIN')
    const stepRes = await client.query(
      `SELECT s.*, ar.work_instruction_id, ar.submitted_by,
              wi.wi_number, wi.title AS wi_title, wi.revision
       FROM public.approval_steps s
       JOIN public.approval_records ar ON ar.id = s.approval_record_id
       JOIN public.work_instructions wi ON wi.id = ar.work_instruction_id
       WHERE s.id = $1
         AND s.tenant_id = $2
         AND ar.tenant_id = $2
         AND wi.tenant_id = $2
       FOR UPDATE`,
      [req.params.stepId, req.user!.tenantId]
    )
    if (stepRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Approval step not found' }); return
    }

    const step = stepRes.rows[0]
    if (step.status !== 'active') {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Only the active approval step can be rejected' }); return
    }
    if (req.user!.role !== 'admin' && step.approver_id !== req.user!.id) {
      await client.query('ROLLBACK')
      res.status(403).json({ error: 'This approval step is assigned to another approver' }); return
    }

    await client.query(
      `UPDATE public.approval_steps
       SET status = 'rejected', comment = $1, completed_at = NOW()
       WHERE id = $2`,
      [comment.trim(), req.params.stepId]
    )
    await client.query(
      `UPDATE public.approval_records
       SET final_status = 'rejected', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [step.approval_record_id]
    )
    await client.query(
      `UPDATE public.work_instructions
       SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [step.work_instruction_id, req.user!.tenantId]
    )

    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.rejected',
      entityType: 'approval_records',
      entityId: step.approval_record_id,
      severity: 'warning',
      detail: { wi_number: step.wi_number, step_number: step.step_number, comment: comment.trim() },
    })
    await createNotification({
      tenantId: req.user!.tenantId,
      userId: step.submitted_by,
      title: `Work Instruction Rejected - ${step.wi_number}`,
      message: `${step.wi_title} ${step.revision} was rejected: ${comment.trim()}`,
      severity: 'warning',
      entityType: 'work_instructions',
      entityId: step.work_instruction_id,
    })

    res.json({ data: { success: true, finalStatus: 'rejected' } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

export default router
