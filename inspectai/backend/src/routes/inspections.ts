import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/inspections  — list work orders
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('*')
      .order('due_date', { ascending: true })

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/inspections/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('*, checklist_items(*)')
      .eq('id', req.params.id)
      .single()

    if (error) throw new Error(error.message)
    if (!data)  { res.status(404).json({ error: 'Work order not found' }); return }
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/inspections/:id/items/:itemId  — record pass/fail
router.patch('/:id/items/:itemId', requireAuth, async (req, res, next) => {
  try {
    const { result, notes, failureCode } = req.body as {
      result: 'pass' | 'fail'; notes?: string; failureCode?: string
    }
    const { data, error } = await supabase
      .from('checklist_items')
      .update({ result, notes, failure_code: failureCode, updated_at: new Date().toISOString() })
      .eq('id', req.params.itemId)
      .eq('work_order_id', req.params.id)
      .select()
      .single()

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// POST /api/inspections/:id/complete
router.post('/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
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
