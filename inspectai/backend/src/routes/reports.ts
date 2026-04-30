import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/reports/inspection-summary?days=30
router.get('/inspection-summary', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const days  = Math.min(parseInt(String(req.query.days ?? '30')), 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const result = await query(
      `SELECT
         wo.wo_number,
         wo.asset_name,
         wo.location,
         wo.completed_at,
         u.name        AS inspector_name,
         wi.wi_number  AS wi_number,
         wi.title      AS wi_title,
         ir.overall_result,
         COUNT(f.id)   AS total_findings,
         SUM(CASE WHEN f.result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
         SUM(CASE WHEN f.result = 'fail' THEN 1 ELSE 0 END) AS fail_count
       FROM   public.work_orders wo
       JOIN   public.inspection_records ir  ON ir.work_order_id = wo.id
       LEFT JOIN public.users u             ON u.id  = ir.inspector_id
       LEFT JOIN public.work_instructions wi ON wi.id = wo.work_instruction_id
       LEFT JOIN public.inspection_findings f ON f.inspection_record_id = ir.id
       WHERE  wo.tenant_id = $1
         AND  wo.status = 'complete'
         AND  wo.completed_at >= $2
       GROUP BY wo.wo_number, wo.asset_name, wo.location, wo.completed_at,
                u.name, wi.wi_number, wi.title, ir.overall_result
       ORDER BY wo.completed_at DESC NULLS LAST
       LIMIT  200`,
      [req.user!.tenantId, since]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/reports/wi-compliance
router.get('/wi-compliance', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT
         wi.wi_number,
         wi.title,
         wi.revision,
         wi.status,
         wi.effective_date,
         wi.expiry_date,
         u.name AS owner_name,
         CASE
           WHEN wi.expiry_date IS NULL THEN NULL
           ELSE ROUND(EXTRACT(EPOCH FROM (wi.expiry_date::timestamptz - NOW())) / 86400)
         END AS days_remaining
       FROM   public.work_instructions wi
       LEFT JOIN public.users u ON u.id = wi.owner_id
       WHERE  wi.tenant_id = $1
       ORDER BY wi.expiry_date ASC NULLS LAST`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/reports/defect-analysis?days=30
router.get('/defect-analysis', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const days  = Math.min(parseInt(String(req.query.days ?? '30')), 365)
    const since = new Date(Date.now() - days * 86_400_000).toISOString()

    const result = await query(
      `SELECT
         COALESCE(ci.description, 'Unknown item') AS item_description,
         COALESCE(ci.category, 'General')         AS category,
         COUNT(*) AS fail_count,
         string_agg(DISTINCT f.notes, ' | ') FILTER (WHERE f.notes IS NOT NULL AND f.notes != '') AS sample_notes
       FROM   public.inspection_findings f
       JOIN   public.inspection_records ir   ON ir.id = f.inspection_record_id
       LEFT JOIN public.wi_checklist_items ci ON ci.id = f.checklist_item_id
       WHERE  ir.tenant_id = $1
         AND  ir.started_at >= $2
         AND  f.result = 'fail'
       GROUP BY ci.description, ci.category
       ORDER BY fail_count DESC
       LIMIT  50`,
      [req.user!.tenantId, since]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

export default router
