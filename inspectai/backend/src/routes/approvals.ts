import { Router } from 'express'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { pool, query, beginActorTransaction } from '../lib/db'
import { auditLog, createNotification } from '../lib/events'
import { eligibleReviewers, submittedFormHash } from '../lib/approvalAssignment'

const router = Router()
const lockRun = (client: any, stepId: string, tenantId: string) => client.query(
  `SELECT ar.id FROM public.approval_records ar JOIN public.approval_steps s ON s.approval_record_id=ar.id AND s.tenant_id=ar.tenant_id
   WHERE s.id=$1 AND ar.tenant_id=$2 FOR UPDATE OF ar`, [stepId, tenantId],
)

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
         ar.workflow_version_id,
         ar.route_snapshot,
         ar.submitted_snapshot,
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
             'skipped',       s.skipped,
             'group_rule',    s.group_rule,
             'stage_size',    s.stage_size,
               'comment',       s.comment,
               'completed_at',  s.completed_at,
               'approver_id',   s.approver_id,
               'approver_name', COALESCE(s.assigned_name,u_app.name),
               'eligible', COALESCE(u_app.active AND ('form_approver'=ANY(u_app.capabilities) OR 'administrator'=ANY(u_app.capabilities))
                 AND (u_app.primary_department_id=wi.department_id OR EXISTS(SELECT 1 FROM public.department_memberships dm WHERE dm.tenant_id=ar.tenant_id AND dm.user_id=u_app.id AND dm.department_id=wi.department_id))
                 AND u_app.id<>ar.submitted_by AND u_app.id IS DISTINCT FROM wi.owner_id AND NOT inspectai_private.form_contributor(wi.id,u_app.id),false),
               'reassignments', COALESCE((SELECT json_agg(json_build_object('from',h.previous_reviewer_id,'to',h.replacement_reviewer_id,'reason',h.reason,'at',h.created_at,'by',h.changed_by) ORDER BY h.created_at) FROM public.approval_reassignments h WHERE h.step_id=s.id AND h.tenant_id=ar.tenant_id),'[]'::json),
               'decided_by',s.decided_by,
               'decision_by_name',u_dec.name
             ) ORDER BY s.step_number
           ) FILTER (WHERE s.id IS NOT NULL),
           '[]'::json
         ) AS approval_steps
       FROM   public.approval_records ar
       JOIN   public.work_instructions wi ON wi.id = ar.work_instruction_id
       LEFT JOIN public.users u_sub       ON u_sub.id = ar.submitted_by
       LEFT JOIN public.approval_steps s  ON s.approval_record_id = ar.id
       LEFT JOIN public.users u_app       ON u_app.id = s.approver_id
       LEFT JOIN public.users u_dec ON u_dec.id=s.decided_by AND u_dec.tenant_id=ar.tenant_id
       WHERE  ar.tenant_id = $1
       GROUP BY ar.id, wi.id, u_sub.name
       ORDER BY ar.submitted_at DESC`,
      [req.user!.tenantId],
    )
    res.json({ data: result.rows.map((record) => {
      const current = record.approval_steps.filter((step: any) => step.step_number === record.current_step && step.status === 'active' && !step.skipped)
      const blocked = record.final_status === 'active' && current.length > 0 && (current[0].group_rule === 'all' ? current.some((step: any) => !step.eligible) : current.every((step: any) => !step.eligible))
      return { ...record, stage_blocked: blocked }
    }) })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/approvals/steps/:stepId/approve
router.patch(
  '/steps/:stepId/approve',
  requireAuth,
  requireCapability('form_approver'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      const { comment } = req.body as { comment?: string }
      await beginActorTransaction(client)
      await lockRun(client, req.params.stepId, req.user!.tenantId)

      const stepRes = await client.query(
        `SELECT s.*, ar.work_instruction_id, ar.submitted_by, ar.final_status, ar.current_step, ar.workflow_version_id, ar.submitted_hash,
              wi.wi_number, wi.title AS wi_title, wi.revision, wi.owner_id
       FROM public.approval_steps s
       JOIN public.approval_records ar ON ar.id = s.approval_record_id
       JOIN public.work_instructions wi ON wi.id = ar.work_instruction_id
       WHERE s.id = $1
         AND s.tenant_id = $2
         AND ar.tenant_id = $2
         AND wi.tenant_id = $2
       FOR UPDATE`,
        [req.params.stepId, req.user!.tenantId],
      )
      if (stepRes.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Approval step not found' })
        return
      }

      const step = stepRes.rows[0]
      if (step.status === 'done' && step.decided_by === req.user!.id) {
        await client.query('ROLLBACK'); res.json({ data: { success: true, finalStatus: step.final_status, alreadyDecided: true } }); return
      }
      if (step.final_status !== 'active') { await client.query('ROLLBACK'); res.status(409).json({ error: 'This approval run has ended.' }); return }
      if (step.workflow_version_id) {
        const candidates = await eligibleReviewers(client.query.bind(client), req.user!.tenantId, step.work_instruction_id, step.submitted_by)
        if (step.approver_id !== req.user!.id || !candidates.some((user) => user.id === req.user!.id)) {
          await client.query('ROLLBACK'); res.status(403).json({ error: 'This workflow requires its assigned eligible independent reviewer. An administrator can reassign a blocked task with a recorded reason.' }); return
        }
      }
      if (step.submitted_hash) {
        const form = (await client.query('SELECT * FROM public.work_instructions WHERE id=$1 AND tenant_id=$2', [step.work_instruction_id, req.user!.tenantId])).rows[0]
        const items = (await client.query('SELECT * FROM public.wi_checklist_items WHERE work_instruction_id=$1 AND tenant_id=$2 ORDER BY sort_order,id', [step.work_instruction_id, req.user!.tenantId])).rows
        if (submittedFormHash(form, items) !== step.submitted_hash) { await client.query('ROLLBACK'); res.status(409).json({ error: 'The submitted revision no longer matches its saved content. Return it for changes and submit a new approval run.' }); return }
      }
      if (step.submitted_by === req.user!.id || step.owner_id === req.user!.id) {
        await client.query('ROLLBACK')
        res.status(403).json({ error: 'Submitter cannot approve their own revision' })
        return
      }
      if (step.skipped || step.status !== 'active' || step.current_step !== step.step_number) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only the active approval step can be approved' })
        return
      }
      if (!req.user!.capabilities.includes('administrator') && step.approver_id !== req.user!.id) {
        await client.query('ROLLBACK')
        res.status(403).json({ error: 'This approval step is assigned to another approver' })
        return
      }

      await client.query(
        `UPDATE public.approval_steps
       SET status = 'done', comment = $1, completed_at = NOW()
       WHERE id = $2`,
        [comment || null, req.params.stepId],
      )

      let finalStatus: 'active' | 'done' = 'active'
      let nextApproverIds: string[] = []
      const stageRes = await client.query(
        `SELECT max(group_rule) AS group_rule,max(stage_size)::int AS stage_size,
                count(*) FILTER (WHERE status='done')::int AS approved_count
         FROM public.approval_steps WHERE approval_record_id=$1 AND step_number=$2 AND skipped=false`,
        [step.approval_record_id, step.step_number],
      )
      const stage = stageRes.rows[0]
      const stageComplete = stage.group_rule === 'any'
        ? stage.approved_count >= 1
        : stage.approved_count >= stage.stage_size
      if (stageComplete && stage.group_rule === 'any') {
        await client.query(
          `UPDATE public.approval_steps SET status='wait',skipped=true
           WHERE approval_record_id=$1 AND step_number=$2 AND id<>$3 AND status='active' AND skipped=false`,
          [step.approval_record_id, step.step_number, req.params.stepId],
        )
      }
      if (stageComplete) {
        const nextRes = await client.query(
          `SELECT min(step_number)::int AS step_number FROM public.approval_steps
           WHERE approval_record_id=$1 AND status='wait' AND skipped=false AND step_number>$2`,
          [step.approval_record_id, step.step_number],
        )
        const nextStepNumber = nextRes.rows[0]?.step_number
        if (nextStepNumber != null) {
          const nextSteps = await client.query(
            `UPDATE public.approval_steps SET status='active' WHERE approval_record_id=$1 AND step_number=$2 AND status='wait' AND skipped=false RETURNING approver_id`,
            [step.approval_record_id, nextStepNumber],
          )
          nextApproverIds = [...new Set(nextSteps.rows.map((row) => row.approver_id).filter(Boolean))]
          await client.query(
            'UPDATE public.approval_records SET current_step=$1,updated_at=NOW() WHERE id=$2',
            [nextStepNumber, step.approval_record_id],
          )
        } else {
        finalStatus = 'done'
        await client.query(
          `UPDATE public.approval_records
         SET final_status = 'done', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
          [step.approval_record_id],
        )
        await client.query(
          `UPDATE public.work_instructions
         SET status = 'superseded', updated_at = NOW()
         WHERE tenant_id = $1
           AND wi_number = $2
           AND id <> $3
           AND status IN ('active', 'expiring', 'expired')`,
          [req.user!.tenantId, step.wi_number, step.work_instruction_id],
        )
        await client.query(
          `UPDATE public.work_instructions
         SET status = 'active',
             effective_date = COALESCE(effective_date, CURRENT_DATE),
             updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
          [step.work_instruction_id, req.user!.tenantId],
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
          ],
        )
        }
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

      if (nextApproverIds.length) {
        await Promise.all(nextApproverIds.map((userId) => createNotification({
          tenantId: req.user!.tenantId,
          userId,
          title: `Approval Required - ${step.wi_number}`,
          message: `${step.wi_title} ${step.revision} is ready for your approval.`,
          severity: 'info',
          entityType: 'approval_records',
          entityId: step.approval_record_id,
        })))
      } else if (finalStatus === 'done') {
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
  },
)

// PATCH /api/approvals/steps/:stepId/reject
router.patch(
  '/steps/:stepId/reject',
  requireAuth,
  requireCapability('form_approver'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      const { comment } = req.body as { comment?: string }
      if (!comment?.trim()) {
        res.status(400).json({ error: 'A rejection comment is required' })
        return
      }

      await beginActorTransaction(client)
      await lockRun(client, req.params.stepId, req.user!.tenantId)
      const stepRes = await client.query(
        `SELECT s.*, ar.work_instruction_id, ar.submitted_by, ar.current_step, ar.final_status, ar.workflow_version_id,
              wi.wi_number, wi.title AS wi_title, wi.revision
       FROM public.approval_steps s
       JOIN public.approval_records ar ON ar.id = s.approval_record_id
       JOIN public.work_instructions wi ON wi.id = ar.work_instruction_id
       WHERE s.id = $1
         AND s.tenant_id = $2
         AND ar.tenant_id = $2
         AND wi.tenant_id = $2
       FOR UPDATE`,
        [req.params.stepId, req.user!.tenantId],
      )
      if (stepRes.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Approval step not found' })
        return
      }

      const step = stepRes.rows[0]
      if (step.final_status !== 'active') { await client.query('ROLLBACK'); res.status(409).json({ error: 'This approval run has ended.' }); return }
      if (step.workflow_version_id) {
        const candidates = await eligibleReviewers(client.query.bind(client), req.user!.tenantId, step.work_instruction_id, step.submitted_by)
        if (step.approver_id !== req.user!.id || !candidates.some((user) => user.id === req.user!.id)) { await client.query('ROLLBACK'); res.status(403).json({ error: 'Only the assigned eligible independent reviewer can return this workflow for changes.' }); return }
      }
      if (step.submitted_by === req.user!.id) {
        await client.query('ROLLBACK')
        res.status(403).json({ error: 'Submitter cannot approve their own revision' })
        return
      }
      if (step.skipped || step.status !== 'active' || step.current_step !== step.step_number) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only the active approval step can be rejected' })
        return
      }
      if (!req.user!.capabilities.includes('administrator') && step.approver_id !== req.user!.id) {
        await client.query('ROLLBACK')
        res.status(403).json({ error: 'This approval step is assigned to another approver' })
        return
      }

      await client.query(
        `UPDATE public.approval_steps
       SET status = 'rejected', comment = $1, completed_at = NOW()
       WHERE id = $2`,
        [comment.trim(), req.params.stepId],
      )
      await client.query(
        `UPDATE public.approval_records
       SET final_status = 'rejected', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
        [step.approval_record_id],
      )
      await client.query(
        `UPDATE public.approval_steps SET skipped=true,status=CASE WHEN status='active' THEN 'wait'::public.step_status ELSE status END
         WHERE approval_record_id=$1 AND status IN ('active','wait')`,
        [step.approval_record_id],
      )
      await client.query(
        `UPDATE public.work_instructions
       SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
        [step.work_instruction_id, req.user!.tenantId],
      )

      await client.query('COMMIT')

      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'wi.rejected',
        entityType: 'approval_records',
        entityId: step.approval_record_id,
        severity: 'warning',
        detail: {
          wi_number: step.wi_number,
          step_number: step.step_number,
          comment: comment.trim(),
        },
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
  },
)

router.get('/steps/:stepId/replacements', requireAuth, requireCapability('administrator'), async (req: AuthRequest, res, next) => {
  try {
    const found = await query(`SELECT s.approval_record_id,s.step_number,ar.work_instruction_id,ar.submitted_by
      FROM public.approval_steps s JOIN public.approval_records ar ON ar.id=s.approval_record_id AND ar.tenant_id=s.tenant_id
      WHERE s.id=$1 AND s.tenant_id=$2 AND ar.final_status='active' AND s.status IN ('active','wait') AND NOT s.skipped`, [req.params.stepId, req.user!.tenantId])
    if (!found.rowCount) { res.status(404).json({ error: 'Pending assignment not found.' }); return }
    const step = found.rows[0]
    const candidates = await eligibleReviewers(query, req.user!.tenantId, step.work_instruction_id, step.submitted_by)
    const assigned = (await query('SELECT approver_id FROM public.approval_steps WHERE approval_record_id=$1 AND step_number=$2', [step.approval_record_id, step.step_number])).rows
    res.json({ data: candidates.filter((person) => !assigned.some((row) => row.approver_id === person.id)) })
  } catch (error) { next(error) }
})

router.post('/steps/:stepId/reassign', requireAuth, requireCapability('administrator'), async (req: AuthRequest, res, next) => {
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
  const replacementId = req.body.reviewerId
  if (!reason || reason.length > 2000 || typeof replacementId !== 'string' || !/^[0-9a-f-]{36}$/i.test(replacementId)) { res.status(400).json({ error: 'Select a reviewer and give a reason of 1 to 2,000 characters.' }); return }
  const client = await pool.connect()
  try {
    await beginActorTransaction(client)
    await lockRun(client, req.params.stepId, req.user!.tenantId)
    const found = await client.query(`SELECT s.*,ar.final_status,ar.work_instruction_id,ar.submitted_by FROM public.approval_steps s
      JOIN public.approval_records ar ON ar.id=s.approval_record_id AND ar.tenant_id=s.tenant_id WHERE s.id=$1 AND s.tenant_id=$2 FOR UPDATE OF s`, [req.params.stepId, req.user!.tenantId])
    if (!found.rowCount) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Assignment not found.' }); return }
    const step = found.rows[0]
    if (step.final_status !== 'active' || step.skipped || !['active','wait'].includes(step.status)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Only pending assignments in an active run can be reassigned.' }); return }
    const candidates = await eligibleReviewers(client.query.bind(client), req.user!.tenantId, step.work_instruction_id, step.submitted_by)
    if (candidates.some((person) => person.id === step.approver_id)) { await client.query('ROLLBACK'); res.status(409).json({ error: 'This assigned reviewer is still eligible. Reassignment is reserved for reviewers who have lost access.' }); return }
    const replacement = candidates.find((person) => person.id === replacementId)
    const duplicate = await client.query('SELECT 1 FROM public.approval_steps WHERE approval_record_id=$1 AND step_number=$2 AND approver_id=$3', [step.approval_record_id, step.step_number, replacementId])
    if (!replacement || duplicate.rowCount) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Choose a different eligible independent reviewer who is not already assigned to this stage.' }); return }
    await client.query("SELECT set_config('app.change_reason',$1,true)", [reason])
    await client.query('INSERT INTO public.approval_reassignments(tenant_id,step_id,previous_reviewer_id,replacement_reviewer_id,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)', [req.user!.tenantId, step.id, step.approver_id, replacementId, req.user!.id, reason])
    await client.query('UPDATE public.approval_steps SET approver_id=$1,assigned_name=$2 WHERE id=$3', [replacementId, replacement.name, step.id])
    await client.query('COMMIT')
    if (step.status === 'active') await createNotification({ tenantId: req.user!.tenantId, userId: replacementId, title: 'Approval reassigned to you', message: `An administrator reassigned the pending ${step.label || 'approval'} task.`, entityType: 'approval_records', entityId: step.approval_record_id })
    res.json({ data: { success: true } })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); next(error) } finally { client.release() }
})

export default router
