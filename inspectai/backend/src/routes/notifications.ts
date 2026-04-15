import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/notifications
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw new Error(error.message)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/read-all
router.patch('/read-all', requireAuth, async (_req, res, next) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('read', false)

    if (error) throw new Error(error.message)
    res.json({ message: 'All notifications marked as read' })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', req.params.id)

    if (error) throw new Error(error.message)
    res.json({ message: 'Notification marked as read' })
  } catch (err) {
    next(err)
  }
})

export default router
