import { Router } from 'express'
import crypto from 'crypto'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { pool, query } from '../lib/db'
import { auditLog, createNotification, notifyRoles } from '../lib/events'

const router = Router()

;(async () => {
  try {
    await query(`ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS asset_record_id UUID REFERENCES public.assets(id) ON DELETE SET NULL`)
    await query(`CREATE INDEX IF NOT EXISTS idx_wo_asset_record ON public.work_orders(tenant_id, asset_record_id)`)
    await query(`ALTER TABLE public.inspection_records ADD COLUMN IF NOT EXISTS signature_data_url TEXT`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS photo_urls TEXT[]`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS ai_validation_status TEXT`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS ai_validation_confidence NUMERIC`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS ai_validation_reason TEXT`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS ai_validation_recommended_result TEXT`)
    await query(`ALTER TABLE public.inspection_findings ADD COLUMN IF NOT EXISTS ai_validation_evidence JSONB`)
  } catch (e) {
    console.warn('[inspections] column migration warning:', (e as Error).message)
  }
})()

// GET /api/inspections - list work orders
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const statusFilter = req.query.status ? String(req.query.status) : null
    const search = req.query.search ? String(req.query.search).trim() : ''
    const woNumber = req.query.woNumber ? String(req.query.woNumber).trim() : ''
    const asset = req.query.asset ? String(req.query.asset).trim() : ''
    const location = req.query.location ? String(req.query.location).trim() : ''
    const wi = req.query.wi ? String(req.query.wi).trim() : ''
    const inspector = req.query.inspector ? String(req.query.inspector).trim() : ''
    const dueDate = req.query.dueDate ? String(req.query.dueDate).trim() : ''
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50))
    const params: unknown[] = [req.user!.tenantId]
    if (statusFilter) params.push(statusFilter)
    if (search) params.push(`%${search}%`)
    const statusClause = statusFilter ? `AND wo.status = $2` : ''
    const searchClause = search ? `AND (
           wo.wo_number ILIKE $${params.length}
        OR COALESCE(a.name, wo.asset_name) ILIKE $${params.length}
        OR COALESCE(a.location, wo.location) ILIKE $${params.length}
        OR wi.wi_number ILIKE $${params.length}
        OR wi.title ILIKE $${params.length}
        OR u.name ILIKE $${params.length}
      )` : ''
    const fieldClauses: string[] = []
    const addLikeFilter = (value: string, clause: (index: number) => string) => {
      if (!value) return
      params.push(`%${value}%`)
      fieldClauses.push(clause(params.length))
    }
    addLikeFilter(woNumber, index => `AND wo.wo_number ILIKE $${index}`)
    addLikeFilter(asset, index => `AND COALESCE(a.name, wo.asset_name) ILIKE $${index}`)
    addLikeFilter(location, index => `AND COALESCE(a.location, wo.location) ILIKE $${index}`)
    addLikeFilter(wi, index => `AND (wi.wi_number ILIKE $${index} OR wi.title ILIKE $${index})`)
    addLikeFilter(inspector, index => `AND u.name ILIKE $${index}`)
    if (dueDate) {
      params.push(dueDate)
      fieldClauses.push(`AND wo.due_date = $${params.length}`)
    }
    const limitParam = params.length + 1
    const offsetParam = params.length + 2

    const result = await query(
      `SELECT wo.id, wo.wo_number,
              COALESCE(a.name, wo.asset_name) AS asset_name,
              COALESCE(a.location, wo.location) AS location,
              wo.type,
              wo.priority, wo.status, wo.due_date, wo.completed_at, wo.notes,
              u.name  AS assigned_to_name,
              wi.wi_number AS wi_number, wi.title AS wi_title,
              (
                SELECT COUNT(*)::int
                FROM public.wi_checklist_items ci
                WHERE ci.work_instruction_id = wo.work_instruction_id
                  AND ci.tenant_id = wo.tenant_id
                  AND COALESCE(ci.field_type, 'pass_fail') <> 'heading'
              ) AS checklist_item_count
       FROM   public.work_orders wo
       LEFT JOIN public.assets a ON a.id = wo.asset_record_id AND a.tenant_id = wo.tenant_id
       LEFT JOIN public.users u  ON u.id = wo.assigned_to
       LEFT JOIN public.work_instructions wi ON wi.id = wo.work_instruction_id
       WHERE  wo.tenant_id = $1
         ${statusClause}
         ${searchClause}
         ${fieldClauses.join('\n         ')}
       ORDER  BY wo.due_date ASC NULLS LAST
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, (page - 1) * pageSize]
    )
    res.json({ data: result.rows, meta: { page, pageSize, hasMore: result.rows.length === pageSize } })
  } catch (err) { next(err) }
})

// GET /api/inspections/summary - aggregate counts without loading every work order
router.get('/summary', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'open')::int AS open,
              COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
              COUNT(*) FILTER (WHERE status = 'complete')::int AS complete,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM public.work_orders
       WHERE tenant_id = $1`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// GET /api/inspections/:id/record - latest inspection record for a work order
router.get('/:id/record', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const recordRes = await query(
      `SELECT ir.*
       FROM public.inspection_records ir
       JOIN public.work_orders wo ON wo.id = ir.work_order_id
       WHERE ir.work_order_id = $1
         AND ir.tenant_id = $2
         AND wo.tenant_id = $2
       ORDER BY ir.created_at DESC
       LIMIT 1`,
      [req.params.id, req.user!.tenantId]
    )
    if (recordRes.rows.length === 0) {
      res.json({ data: null }); return
    }

    const record = recordRes.rows[0]
    const findingsRes = await query(
      `SELECT id, result, notes, photo_urls,
              ai_root_cause, ai_failure_class, ai_failure_code, ai_recommended_action,
              ai_validation_status, ai_validation_confidence, ai_validation_reason,
              ai_validation_recommended_result, ai_validation_evidence,
              checklist_item_id
       FROM public.inspection_findings
       WHERE inspection_record_id = $1
         AND tenant_id = $2
       ORDER BY created_at ASC`,
      [record.id, req.user!.tenantId]
    )

    res.json({ data: { ...record, inspection_findings: findingsRes.rows } })
  } catch (err) { next(err) }
})

// GET /api/inspections/:id - single work order with checklist items
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
         JOIN   public.work_orders wo ON wo.work_instruction_id = ci.work_instruction_id
         WHERE  wo.id = $1
           AND  wo.tenant_id = $2
         ORDER  BY ci.sort_order`,
        [req.params.id, req.user!.tenantId]
      ),
    ])

    if (woResult.rows.length === 0) {
      res.status(404).json({ error: 'Work order not found' }); return
    }
    res.json({ data: { ...woResult.rows[0], checklist_items: itemsResult.rows } })
  } catch (err) { next(err) }
})

// POST /api/inspections - create work order
router.post('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { assetId, priority, dueDate, assignedTo, workInstructionId, notes } = req.body
    const allowedPriorities = new Set(['low', 'medium', 'high', 'critical'])
    const normalizedPriority = priority || 'medium'
    if (!assetId || typeof assetId !== 'string') {
      res.status(400).json({ error: 'A registered asset is required' }); return
    }
    const assetRes = await query(
      `SELECT id, name, location FROM public.assets WHERE id = $1 AND tenant_id = $2`,
      [assetId, req.user!.tenantId]
    )
    if (assetRes.rows.length === 0) {
      res.status(400).json({ error: 'Asset must belong to your tenant' }); return
    }
    const asset = assetRes.rows[0]
    if (!allowedPriorities.has(normalizedPriority)) {
      res.status(400).json({ error: 'Invalid work order priority' }); return
    }
    if (assignedTo) {
      const userRes = await query(
        `SELECT id FROM public.users WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [assignedTo, req.user!.tenantId]
      )
      if (userRes.rows.length === 0) {
        res.status(400).json({ error: 'Assigned user must be active in your tenant' }); return
      }
    }
    if (!workInstructionId) {
      res.status(400).json({ error: 'Work instruction is required for every work order' }); return
    }
    const wiRes = await query(
      `SELECT wi.id,
              COUNT(ci.id) FILTER (
                WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
              )::int AS checkable_item_count
       FROM public.work_instructions wi
       LEFT JOIN public.wi_checklist_items ci
         ON ci.work_instruction_id = wi.id
        AND ci.tenant_id = wi.tenant_id
       WHERE wi.id = $1
         AND wi.tenant_id = $2
       GROUP BY wi.id`,
      [workInstructionId, req.user!.tenantId]
    )
    if (wiRes.rows.length === 0) {
      res.status(400).json({ error: 'Work instruction must belong to your tenant' }); return
    }
    if ((wiRes.rows[0].checkable_item_count ?? 0) < 1) {
      res.status(400).json({ error: 'Selected work instruction has no checklist items' }); return
    }

    const client = await pool.connect()
    let workOrder: Record<string, any>
    try {
      await client.query('BEGIN')
      // Serialize numbering per tenant so concurrent creates cannot receive the same WO number.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [req.user!.tenantId])
      const numberRes = await client.query(
        `SELECT COALESCE(MAX((substring(wo_number FROM '[0-9]+'))::int), 0) AS highest
         FROM public.work_orders WHERE tenant_id = $1`,
        [req.user!.tenantId]
      )
      const nextNumber = Number(numberRes.rows[0].highest) + 1
      const woNumber = `WO-${String(nextNumber).padStart(4, '0')}`
      const result = await client.query(
        `INSERT INTO public.work_orders
           (wo_number, tenant_id, asset_name, asset_record_id, location, priority, due_date, assigned_to, work_instruction_id, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)
         RETURNING *`,
        [woNumber, req.user!.tenantId, asset.name, asset.id, asset.location, normalizedPriority, dueDate || null,
         assignedTo || null, workInstructionId, notes || null, req.user!.id]
      )
      await client.query('COMMIT')
      workOrder = result.rows[0]
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'work_order.created',
      entityType: 'work_orders',
      entityId: workOrder.id,
      detail: { wo_number: workOrder.wo_number, asset_name: workOrder.asset_name, asset_id: workOrder.asset_record_id },
    })
    if (assignedTo) {
      await createNotification({
        tenantId: req.user!.tenantId,
        userId: assignedTo,
        title: `New Work Order Assigned - ${workOrder.wo_number}`,
        message: `${workOrder.asset_name}${workOrder.location ? ` at ${workOrder.location}` : ''} has been assigned to you.`,
        severity: priority === 'critical' || priority === 'high' ? 'warning' : 'info',
        entityType: 'work_orders',
        entityId: workOrder.id,
      })
    }

    res.status(201).json({ data: workOrder })
  } catch (err) { next(err) }
})

// PATCH /api/inspections/:id/work-instruction - attach or replace the inspection checklist
router.patch('/:id/work-instruction', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { workInstructionId } = req.body as { workInstructionId?: string }
    if (!workInstructionId) {
      res.status(400).json({ error: 'Work instruction is required' }); return
    }

    const [woRes, wiRes] = await Promise.all([
      query(
        `SELECT id, wo_number, status
         FROM public.work_orders
         WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.user!.tenantId]
      ),
      query(
        `SELECT wi.id, wi.wi_number,
                COUNT(ci.id) FILTER (
                  WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
                )::int AS checkable_item_count
         FROM public.work_instructions wi
         LEFT JOIN public.wi_checklist_items ci
           ON ci.work_instruction_id = wi.id
          AND ci.tenant_id = wi.tenant_id
         WHERE wi.id = $1
           AND wi.tenant_id = $2
         GROUP BY wi.id, wi.wi_number`,
        [workInstructionId, req.user!.tenantId]
      ),
    ])

    if (woRes.rows.length === 0) {
      res.status(404).json({ error: 'Work order not found' }); return
    }
    if (woRes.rows[0].status === 'complete') {
      res.status(409).json({ error: 'Completed work orders cannot be reassigned' }); return
    }
    if (wiRes.rows.length === 0) {
      res.status(400).json({ error: 'Work instruction must belong to your tenant' }); return
    }
    if ((wiRes.rows[0].checkable_item_count ?? 0) < 1) {
      res.status(400).json({ error: 'Selected work instruction has no checklist items' }); return
    }

    const result = await query(
      `UPDATE public.work_orders
       SET work_instruction_id = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [workInstructionId, req.params.id, req.user!.tenantId]
    )

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'work_order.work_instruction.assigned',
      entityType: 'work_orders',
      entityId: req.params.id,
      detail: {
        wo_number: woRes.rows[0].wo_number,
        wi_number: wiRes.rows[0].wi_number,
      },
    })

    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// PATCH /api/inspections/:id/status
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body as { status: string }
    const allowedStatuses = new Set(['open', 'in_progress', 'complete', 'cancelled'])
    if (!allowedStatuses.has(status)) {
      res.status(400).json({ error: 'Invalid work order status' }); return
    }
    const completed  = status === 'complete' ? new Date().toISOString() : null
    const result     = await query(
      `UPDATE public.work_orders
       SET    status = $1, completed_at = $2, updated_at = NOW()
       WHERE  id = $3 AND tenant_id = $4
       RETURNING *`,
      [status, completed, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'work_order.status.updated',
      entityType: 'work_orders',
      entityId: req.params.id,
      detail: { status },
    })
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/start - create or resume an inspection record
router.post('/:id/start', requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { totalItems } = req.body
    await client.query('BEGIN')

    const woRes = await client.query(
      `SELECT id, wo_number, asset_name, status, work_instruction_id
       FROM public.work_orders
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user!.tenantId]
    )
    if (woRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found' }); return
    }
    if (!woRes.rows[0].work_instruction_id) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Assign a work instruction with checklist items before starting this inspection' }); return
    }
    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total_items
       FROM public.wi_checklist_items ci
       JOIN public.work_orders wo ON wo.work_instruction_id = ci.work_instruction_id
       WHERE wo.id = $1
         AND wo.tenant_id = $2
         AND ci.tenant_id = $2
         AND COALESCE(ci.field_type, 'pass_fail') <> 'heading'`,
      [req.params.id, req.user!.tenantId]
    )
    const serverTotalItems = totalRes.rows[0]?.total_items ?? totalItems ?? 0
    if (serverTotalItems < 1) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'The linked work instruction has no checklist items' }); return
    }

    const existingRes = await client.query(
      `SELECT *
       FROM public.inspection_records
       WHERE work_order_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.params.id, req.user!.tenantId]
    )
    if (existingRes.rows[0]?.completed_at) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This work order already has a completed inspection' }); return
    }

    let record = existingRes.rows[0]
    if (record) {
      const updatedRecordRes = await client.query(
        `UPDATE public.inspection_records
         SET total_items = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [serverTotalItems, record.id, req.user!.tenantId]
      )
      record = updatedRecordRes.rows[0]
    } else {
      record = (await client.query(
        `INSERT INTO public.inspection_records
           (work_order_id, inspector_id, tenant_id, total_items, started_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [req.params.id, req.user!.id, req.user!.tenantId, serverTotalItems]
      )).rows[0]
    }

    await client.query(
      `UPDATE public.work_orders
       SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    )
    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: existingRes.rows[0] ? 'inspection.resumed' : 'inspection.started',
      entityType: 'inspection_records',
      entityId: record.id,
      detail: { work_order_id: req.params.id, wo_number: woRes.rows[0].wo_number },
    })

    res.json({ data: { ...record, inspection_findings: [] } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// POST /api/inspections/:id/findings - upsert a checklist finding
router.post('/:id/findings', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { inspectionRecordId, checklistItemId, result: findingResult, notes } = req.body
    if (!['pass', 'fail', 'na'].includes(findingResult)) {
      res.status(400).json({ error: 'Invalid finding result' }); return
    }
    const belongsRes = await query(
      `SELECT ir.id, ir.completed_at
       FROM public.inspection_records ir
       JOIN public.work_orders wo ON wo.id = ir.work_order_id
       JOIN public.wi_checklist_items ci
         ON ci.id = $4
        AND ci.work_instruction_id = wo.work_instruction_id
        AND ci.tenant_id = $3
       WHERE ir.id = $1
         AND ir.work_order_id = $2
         AND ir.tenant_id = $3
         AND wo.tenant_id = $3`,
      [inspectionRecordId, req.params.id, req.user!.tenantId, checklistItemId]
    )
    if (belongsRes.rows.length === 0) {
      res.status(404).json({ error: 'Inspection record not found' }); return
    }
    if (belongsRes.rows[0].completed_at) {
      res.status(409).json({ error: 'Completed inspections cannot be changed' }); return
    }

    const result = await query(
      `INSERT INTO public.inspection_findings
         (inspection_record_id, checklist_item_id, result, notes, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (inspection_record_id, checklist_item_id)
       DO UPDATE SET result = EXCLUDED.result, notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING *`,
      [inspectionRecordId, checklistItemId, findingResult, notes || null, req.user!.tenantId]
    )

    await recountInspection(inspectionRecordId, req.user!.tenantId)
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'inspection.finding.saved',
      entityType: 'inspection_findings',
      entityId: result.rows[0].id,
      severity: findingResult === 'fail' ? 'warning' : 'info',
      detail: { checklist_item_id: checklistItemId, result: findingResult },
    })

    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/findings/photo - persist photo evidence for a finding
router.post('/:id/findings/photo', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { inspectionRecordId, checklistItemId, imageDataUrl } = req.body as {
      inspectionRecordId: string
      checklistItemId: string
      imageDataUrl: string
    }
    if (!imageDataUrl?.startsWith('data:image/')) {
      res.status(400).json({ error: 'A data URL image is required' }); return
    }

    const belongsRes = await query(
      `SELECT ir.id, ir.completed_at
       FROM public.inspection_records ir
       JOIN public.work_orders wo ON wo.id = ir.work_order_id
       JOIN public.wi_checklist_items ci
         ON ci.id = $4
        AND ci.work_instruction_id = wo.work_instruction_id
        AND ci.tenant_id = $3
       WHERE ir.id = $1
         AND ir.work_order_id = $2
         AND ir.tenant_id = $3
         AND wo.tenant_id = $3`,
      [inspectionRecordId, req.params.id, req.user!.tenantId, checklistItemId]
    )
    if (belongsRes.rows.length === 0) {
      res.status(404).json({ error: 'Inspection record not found' }); return
    }
    if (belongsRes.rows[0].completed_at) {
      res.status(409).json({ error: 'Completed inspections cannot be changed' }); return
    }

    const result = await query(
      `INSERT INTO public.inspection_findings
         (inspection_record_id, checklist_item_id, tenant_id, photo_urls)
       VALUES ($1, $2, $3, ARRAY[$4]::text[])
       ON CONFLICT (inspection_record_id, checklist_item_id)
       DO UPDATE SET photo_urls = array_append(COALESCE(public.inspection_findings.photo_urls, ARRAY[]::text[]), $4),
                     updated_at = NOW()
       RETURNING *`,
      [inspectionRecordId, checklistItemId, req.user!.tenantId, imageDataUrl]
    )

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'inspection.photo.attached',
      entityType: 'inspection_findings',
      entityId: result.rows[0].id,
      detail: { checklist_item_id: checklistItemId },
    })

    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// POST /api/inspections/:id/complete
router.post('/:id/complete', requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { inspectionRecordId, signatureDataUrl, signedBy } = req.body as {
      inspectionRecordId: string
      signatureDataUrl?: string
      signedBy?: string
    }
    if (!signatureDataUrl?.startsWith('data:image/')) {
      res.status(400).json({ error: 'Signature is required to complete an inspection' }); return
    }

    await client.query('BEGIN')

    const recordRes = await client.query(
      `SELECT ir.*, wo.wo_number, wo.asset_name, wo.location, wo.assigned_to
       FROM public.inspection_records ir
       JOIN public.work_orders wo ON wo.id = ir.work_order_id
       WHERE ir.id = $1
         AND ir.work_order_id = $2
         AND ir.tenant_id = $3
         AND wo.tenant_id = $3
       FOR UPDATE`,
      [inspectionRecordId, req.params.id, req.user!.tenantId]
    )
    if (recordRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Inspection record not found' }); return
    }
    const record = recordRes.rows[0]
    if (record.completed_at) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This inspection is already complete' }); return
    }

    const countRes = await client.query(
      `SELECT
         COUNT(ci.id) FILTER (
           WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
         )::int AS total_items,
         COUNT(ci.id) FILTER (
           WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
             AND ci.required IS DISTINCT FROM false
         )::int AS required_total,
         COUNT(ci.id) FILTER (
           WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
             AND ci.required IS DISTINCT FROM false
             AND f.result IN ('pass', 'fail', 'na')
         )::int AS required_answered,
         COUNT(ci.id) FILTER (WHERE f.result = 'pass')::int AS passed,
         COUNT(ci.id) FILTER (WHERE f.result = 'fail')::int AS failed,
         COUNT(ci.id) FILTER (WHERE f.result = 'na')::int   AS na
       FROM public.work_orders wo
       JOIN public.wi_checklist_items ci
         ON ci.work_instruction_id = wo.work_instruction_id
        AND ci.tenant_id = wo.tenant_id
       LEFT JOIN public.inspection_findings f
         ON f.inspection_record_id = $1
        AND f.checklist_item_id = ci.id
        AND f.tenant_id = wo.tenant_id
       WHERE wo.id = $2
         AND wo.tenant_id = $3`,
      [inspectionRecordId, req.params.id, req.user!.tenantId]
    )
    const counts = countRes.rows[0]
    if (counts.required_answered < counts.required_total) {
      await client.query('ROLLBACK')
      res.status(409).json({
        error: `Complete all required checklist items before signing (${counts.required_answered}/${counts.required_total} complete)`,
      }); return
    }
    const overallResult = counts.failed > 0 ? 'fail' : 'pass'
    let signerId = req.user!.id
    if (signedBy) {
      const signerRes = await client.query(
        `SELECT id FROM public.users WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [signedBy, req.user!.tenantId]
      )
      if (signerRes.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Selected signer is not valid for this tenant' }); return
      }
      signerId = signedBy
    }
    const signatureHash = crypto
      .createHash('sha256')
      .update(`${inspectionRecordId}:${signerId}:${signatureDataUrl}`)
      .digest('hex')

    await client.query(
      `UPDATE public.inspection_records
       SET overall_result = $1,
           completed_at = NOW(),
           passed_items = $2,
           failed_items = $3,
           na_items = $4,
           total_items = $5,
           signed_by = $6,
           signed_at = NOW(),
           signature_data_url = $7,
           signature_hash = $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        overallResult,
        counts.passed,
        counts.failed,
        counts.na,
        counts.total_items,
        signerId,
        signatureDataUrl,
        signatureHash,
        inspectionRecordId,
      ]
    )
    await client.query(
      `UPDATE public.work_orders
       SET status = 'complete', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    )

    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'inspection.completed',
      entityType: 'inspection_records',
      entityId: inspectionRecordId,
      severity: overallResult === 'fail' ? 'warning' : 'info',
      detail: {
        wo_number: record.wo_number,
        passed: counts.passed,
        failed: counts.failed,
        na: counts.na,
        signature_hash: signatureHash,
        signed_by: signerId,
      },
    })

    if (overallResult === 'fail') {
      await notifyRoles(req.user!.tenantId, ['admin', 'approver'], {
        title: `Inspection Failed - ${record.wo_number}`,
        message: `${record.asset_name}${record.location ? ` at ${record.location}` : ''} completed with ${counts.failed} failed item(s).`,
        severity: 'warning',
        entityType: 'inspection_records',
        entityId: inspectionRecordId,
      })
    }

    res.json({
      data: {
        success: true,
        overallResult,
        passed: counts.passed,
        failed: counts.failed,
        na: counts.na,
        signatureHash,
      },
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

async function recountInspection(inspectionRecordId: string, tenantId: string) {
  const countRes = await query(
    `SELECT
       COUNT(ci.id) FILTER (
         WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
       )::int AS total_items,
       COUNT(ci.id) FILTER (WHERE f.result = 'pass')::int AS passed,
       COUNT(ci.id) FILTER (WHERE f.result = 'fail')::int AS failed,
       COUNT(ci.id) FILTER (WHERE f.result = 'na')::int   AS na
     FROM public.inspection_records ir
     JOIN public.work_orders wo
       ON wo.id = ir.work_order_id
      AND wo.tenant_id = ir.tenant_id
     JOIN public.wi_checklist_items ci
       ON ci.work_instruction_id = wo.work_instruction_id
      AND ci.tenant_id = ir.tenant_id
     LEFT JOIN public.inspection_findings f
       ON f.inspection_record_id = ir.id
      AND f.checklist_item_id = ci.id
      AND f.tenant_id = ir.tenant_id
     WHERE ir.id = $1
       AND ir.tenant_id = $2`,
    [inspectionRecordId, tenantId]
  )
  const counts = countRes.rows[0]
  await query(
    `UPDATE public.inspection_records
     SET passed_items = $1, failed_items = $2, na_items = $3, total_items = $4, updated_at = NOW()
     WHERE id = $5 AND tenant_id = $6`,
    [counts.passed, counts.failed, counts.na, counts.total_items, inspectionRecordId, tenantId]
  )
}

export default router
