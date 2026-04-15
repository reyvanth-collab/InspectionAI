import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/analytics/summary?days=30
router.get('/summary', requireAuth, async (req, res, next) => {
  try {
    const days  = parseInt(String(req.query.days ?? '30'))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const [{ count: total }, { count: pass }, { count: fail }] = await Promise.all([
      supabase.from('checklist_items').select('*', { count: 'exact', head: true }).gte('updated_at', since),
      supabase.from('checklist_items').select('*', { count: 'exact', head: true }).eq('result', 'pass').gte('updated_at', since),
      supabase.from('checklist_items').select('*', { count: 'exact', head: true }).eq('result', 'fail').gte('updated_at', since),
    ])

    const passRate = total ? Math.round(((pass ?? 0) / total) * 100) : 0

    res.json({ data: { total, pass, fail, passRate, days } })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/by-category?days=30
router.get('/by-category', requireAuth, async (req, res, next) => {
  try {
    const days  = parseInt(String(req.query.days ?? '30'))
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const { data, error } = await supabase
      .from('checklist_items')
      .select('category, result')
      .gte('updated_at', since)
      .not('result', 'is', null)

    if (error) throw new Error(error.message)

    // Aggregate client-side (small dataset)
    const byCategory: Record<string, { pass: number; fail: number }> = {}
    for (const item of data ?? []) {
      const cat = (item as { category: string; result: string }).category ?? 'Uncategorised'
      byCategory[cat] ??= { pass: 0, fail: 0 }
      if ((item as { result: string }).result === 'pass') byCategory[cat].pass++
      else byCategory[cat].fail++
    }

    res.json({ data: byCategory })
  } catch (err) {
    next(err)
  }
})

export default router
