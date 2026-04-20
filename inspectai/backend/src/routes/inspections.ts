import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

// GET /api/inspections — list work orders
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT wo.id, wo.wo_number, wo.asset_name, wo.location, wo.type,
              wo.priority, wo.status, wo.due_date, wo.completed_at, wo.notes,
              u.name  AS assigned_to_name,
              wi.wi_number AS wi_number, wi.title AS wi_title
       FROM   public.work_orders wo
       LEFT JOIN public.users u  ON u.id = wo.assigned_to
       LEFT JOIN public.work_instructions wi ON wi.id = wo.work_instruction_id
       WHERE  wo.tenant_id = $1
       ORDER  BY wo.due_date ASC NULLS LAST
       LIMIT  100`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// GET /api/inspections/:id — single work order with checklist items
router.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [woResult, itemsResult] = await Promise.all([
      query(
        `SELECT wo.*, u.name AS assigned_to_name,
                wi.wi_number, wi.title AS wi_title, wi.revision
         FROM   public.work_orders wo
         LEFT JOIN public.users u  ON u.id = wo.assigned_to
         LEFT JOIN public.work_instructions wi ON wi.id = wo.work_instruction_id
         WHERE  wo.id = $1 AND wo.tenant_id = $2`,
        [req.params.id, req.user!.tenantId]
      ),
      query(
        `SELECT ci.*
         FROM   public.wi_checklist_items ci
         JOIN   public.work_orders wo ON wo.work_instruction_id = ci.wi_id
         WHERE  wo.id = $1
         ORDER  BY ci.sort_order`,
        [req.params.id]
      ),
    ])

    if (woResult.rows.length === 0) {
      res.status(404).json({ error: 'Work order not found' }); return
    }
    res.json({ data: { ...woResult.rows[0], checklist_items: itemsResult.rows } })
  } catch (err) { next(err) }
})

// POST /api/inspections — create work order
router.post('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { assetName, location, priority, dueDate, assignedTo, workInstructionId, notes } = req.body

    // Generate next WO number
    const countRes = await query('SELECT COUNT(*) FROM public.work_orders WHERE tenant_id = $1', [req.user!.tenantId])
    const count    = parseInt(countRes.rows[0].count)
    const woNumber = `WO-${String(count + 1).padStart(4, '0')}`

    const result = await query(
      `INSERT INTO public.work_orders
         (wo_number, tenant_id, asset_name, location, priority, due_date, assigned_to, work_instruction_id, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
       RETURNING *`,
      [woNumber, req.user!.tenantId, assetName, location, priority, dueDate || null,
       assignedTo || null, workInstructionId || null, notes || null]
    )
    res.status(201).json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// PATCH /api/inspections/:id/status
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body as { status: string }
    const completed  = status === 'complete' ? new Date().toISOString() : null
    const result     = await query(
      `UPDATE public.work_orders
       SET    status = $1, completed_at = $2, updated_at = NOW()
       WHERE  id = $3 AND tenant_id = $4
       RETURNING *`,
      [status, completed, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/start — create inspection record
router.post('/:id/start', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { totalItems } = req.body
    const result = await query(
      `INSERT INTO public.inspection_records (work_order_id, inspector_id, tenant_id, total_items, started_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (work_order_id) DO UPDATE SET started_at = EXCLUDED.started_at
       RETURNING *`,
      [req.params.id, req.user!.id, req.user!.tenantId, totalItems ?? 0]
    )
    // Set WO to in_progress
    await query(
      `UPDATE public.work_orders SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    )
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/findings — upsert a checklist finding
router.post('/:id/findings', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { inspectionRecordId, checklistItemId, result: findingResult, notes } = req.body
    const result = await query(
      `INSERT INTO public.inspection_findings
         (inspection_record_id, checklist_item_id, result, notes, tenant_id, recorded_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (inspection_record_id, checklist_item_id)
       DO UPDATE SET result = EXCLUDED.result, notes = EXCLUDED.notes, recorded_at = NOW()
       RETURNING *`,
      [inspectionRecordId, checklistItemId, findingResult, notes || null, req.user!.tenantId]
    )
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/complete
router.post('/:id/complete', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { inspectionRecordId, overallResult } = req.body
    await Promise.all([
      query(
        `UPDATE public.inspection_records
         SET    overall_result = $1, completed_at = NOW()
         WHERE  id = $2`,
        [overallResult, inspectionRecordId]
      ),
      query(
        `UPDATE public.work_orders
         SET    status = 'complete', completed_at = NOW(), updated_at = NOW()
         WHERE  id = $1`,
        [req.params.id]
      ),
    ])
    res.json({ data: { success: true } })
  } catch (err) { next(err) }
})

export default router
