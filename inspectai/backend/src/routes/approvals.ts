import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/approvals
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('approval_records')
      .select('*, approval_steps(*)')
      .order('submitted_at', { ascending: false })

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// POST /api/approvals/:id/approve  — advance to next step
router.post('/:id/approve', requireAuth, requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const { stepId, comment } = req.body as { stepId: number; comment?: string }

    const { error: stepErr } = await supabase
      .from('approval_steps')
      .update({ status: 'done', comment, completed_at: new Date().toISOString() })
      .eq('approval_record_id', req.params.id)
      .eq('id', stepId)

    if (stepErr) throw new Error(stepErr.message)

    res.json({ message: 'Step approved' })
  } catch (err) {
    next(err)
  }
})

// POST /api/approvals/:id/reject
router.post('/:id/reject', requireAuth, requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const { stepId, comment } = req.body as { stepId: number; comment: string }

    const { error } = await supabase
      .from('approval_steps')
      .update({ status: 'rejected', comment })
      .eq('approval_record_id', req.params.id)
      .eq('id', stepId)

    if (error) throw new Error(error.message)

    res.json({ message: 'Step rejected' })
  } catch (err) {
    next(err)
  }
})

export default router
