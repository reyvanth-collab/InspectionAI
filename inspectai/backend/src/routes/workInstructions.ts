import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/work-instructions
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_instructions')
      .select('*')
      .order('expiry_date', { ascending: true })

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/work-instructions/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_instructions')
      .select('*, revision_history(*), checklist_items(*)')
      .eq('id', req.params.id)
      .single()

    if (error) throw new Error(error.message)
    if (!data)  { res.status(404).json({ error: 'Work instruction not found' }); return }
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// POST /api/work-instructions  (admin/approver only)
router.post('/', requireAuth, requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_instructions')
      .insert({ ...req.body, status: 'draft', created_at: new Date().toISOString() })
      .select()
      .single()

    if (error) throw new Error(error.message)
    res.status(201).json({ data })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/work-instructions/:id/status
router.patch('/:id/status', requireAuth, requireRole('admin', 'approver'), async (req, res, next) => {
  try {
    const { status } = req.body as { status: string }
    const { data, error } = await supabase
      .from('work_instructions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

export default router
