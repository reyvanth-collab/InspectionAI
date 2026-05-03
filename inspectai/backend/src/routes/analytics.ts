import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/analytics/summary?days=30
router.get('/summary', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const days  = Math.min(parseInt(String(req.query.days ?? '30')), 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const [totalRes, passRes, failRes, recordsRes] = await Promise.all([
      query(
        `SELECT COUNT(*) FROM public.inspection_findings f
         JOIN   public.inspection_records r ON r.id = f.inspection_record_id
         WHERE  r.tenant_id = $1 AND r.started_at >= $2`,
        [req.user!.tenantId, since]
      ),
      query(
        `SELECT COUNT(*) FROM public.inspection_findings f
         JOIN   public.inspection_records r ON r.id = f.inspection_record_id
         WHERE  r.tenant_id = $1 AND r.started_at >= $2 AND f.result = 'pass'`,
        [req.user!.tenantId, since]
      ),
      query(
        `SELECT COUNT(*) FROM public.inspection_findings f
         JOIN   public.inspection_records r ON r.id = f.inspection_record_id
         WHERE  r.tenant_id = $1 AND r.started_at >= $2 AND f.result = 'fail'`,
        [req.user!.tenantId, since]
      ),
      query(
        `SELECT COUNT(*) FROM public.inspection_records
         WHERE  tenant_id = $1 AND started_at >= $2`,
        [req.user!.tenantId, since]
      ),
    ])

    const total    = parseInt(totalRes.rows[0].count)
    const pass     = parseInt(passRes.rows[0].count)
    const fail     = parseInt(failRes.rows[0].count)
    const records  = parseInt(recordsRes.rows[0].count)
    const passRate = total > 0 ? Math.round((pass / total) * 100) : 0

    res.json({ data: { total, pass, fail, passRate, totalInspections: records, days } })
  } catch (err) { next(err) }
})

// GET /api/analytics/by-category?days=30
router.get('/by-category', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const days  = Math.min(parseInt(String(req.query.days ?? '30')), 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const result = await query(
      `SELECT   COALESCE(ci.category, 'General') AS category,
                SUM(CASE WHEN f.result = 'pass' THEN 1 ELSE 0 END) AS pass,
                SUM(CASE WHEN f.result = 'fail' THEN 1 ELSE 0 END) AS fail
       FROM     public.inspection_findings f
       JOIN     public.inspection_records r  ON r.id = f.inspection_record_id
       LEFT JOIN public.wi_checklist_items ci ON ci.id = f.checklist_item_id
       WHERE    r.tenant_id = $1
         AND    r.started_at >= $2
         AND    f.result IN ('pass','fail')
       GROUP BY COALESCE(ci.category, 'General')
       ORDER BY (pass + fail) DESC`,
      [req.user!.tenantId, since]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/analytics/audit-logs?limit=100&table=work_instructions
router.get('/audit-logs', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit ?? '100')), 1000)
    const table  = req.query.table ? String(req.query.table) : null
    const params: unknown[] = [req.user!.tenantId, limit]
    if (table) params.push(table)
    const result = await query(
      `SELECT al.id, al.action, al.table_name, al.created_at, u.name AS performed_by_name
       FROM   public.audit_logs al
       LEFT JOIN public.users u ON u.id::text = al.performed_by::text
       WHERE  al.tenant_id = $1
         ${table ? 'AND al.table_name = $3' : ''}
       ORDER  BY al.created_at DESC
       LIMIT  $2`,
      params
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

export default router
