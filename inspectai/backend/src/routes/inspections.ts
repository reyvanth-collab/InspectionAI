import { workOrderFilters } from '../lib/workOrderFilters'
import { listOrder } from '../lib/listOrder'
import { Router } from 'express'
import crypto from 'crypto'
import { normalizeAnswers } from '../lib/inspectionDraft'
import { renderInspectionPdf } from '../lib/inspectionReport'
import { validSignature, canonicalJson } from '../lib/signature'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { pool, query, beginActorTransaction } from '../lib/db'
import { auditLog, createNotification, notifyRoles } from '../lib/events'

const router = Router()
router.use(requireAuth)
router.use((req: AuthRequest, res, next) => {
  if (req.method === 'GET') {
    next()
    return
  }
  if (
    req.path === '/' ||
    req.path.endsWith('/assignment') ||
    req.path.endsWith('/work-instruction')
  ) {
    requireCapability('work_order_manager')(req, res, next)
    return
  }
  requireCapability('inspector')(req, res, next)
})
router.use(async (req: AuthRequest, res, next) => {
  if (req.method === 'GET') {
    next()
    return
  }
  if (
    req.path === '/' ||
    req.path.endsWith('/assignment') ||
    req.path.endsWith('/work-instruction')
  ) {
    requireCapability('work_order_manager')(req, res, next)
    return
  }
  const id = req.path.split('/')[1]
  if (req.path.endsWith('/findings') || req.path.endsWith('/findings/photo')) {
    const draft = await query(
      'SELECT d.record_id FROM public.inspection_drafts d JOIN public.inspection_records r ON r.id=d.record_id WHERE r.work_order_id=$1 AND r.tenant_id=$2',
      [id, req.user!.tenantId],
    )
    if (draft.rows.length) {
      res
        .status(409)
        .json({ error: 'This inspection uses versioned drafts. Reload before editing.' })
      return
    }
  }
  const result = await query(
    'SELECT assigned_to FROM public.work_orders WHERE id = $1 AND tenant_id = $2',
    [id, req.user!.tenantId],
  )
  if (!result.rows.length) {
    res.status(404).json({ error: 'Work order not found' })
    return
  }
  if (
    !req.user!.capabilities.includes('administrator') &&
    result.rows[0].assigned_to !== req.user!.id
  ) {
    res
      .status(403)
      .json({ error: 'Only the assigned inspector or an administrator can change this work order' })
    return
  }
  next()
})

const orderJoins =
  'FROM public.work_orders wo LEFT JOIN public.users u ON u.id=wo.assigned_to LEFT JOIN public.work_instructions wi ON wi.id=wo.work_instruction_id'
async function orderCounts(req: AuthRequest) {
  const { where, params } = workOrderFilters(req)
  return (
    await query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE wo.status='open')::int open,count(*) FILTER(WHERE wo.status='in_progress')::int in_progress,count(*) FILTER(WHERE wo.status='complete')::int complete,count(*) FILTER(WHERE wo.status='cancelled')::int cancelled ${orderJoins} WHERE ${where}`,
      params,
    )
  ).rows[0]
}
router.get('/', async (req: AuthRequest, res) => {
  const { where, params } = workOrderFilters(req),
    page = Math.max(1, parseInt(String(req.query.page || 1)) || 1),
    pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || 50)) || 50))
  const order = listOrder(
    req.query,
    {
      number: 'wo.wo_number',
      asset: 'wo.asset_name',
      location: 'wo.location',
      form: 'wi.wi_number',
      inspector: 'u.name',
      due: 'wo.due_date',
      status: 'wo.status',
    },
    'due',
    'wo.id',
  )
  const [result, summary] = await Promise.all([
    query(
      `SELECT wo.*,u.name assigned_to_name,wi.wi_number,wi.title wi_title,(SELECT count(*)::int FROM public.wi_checklist_items ci WHERE ci.work_instruction_id=wo.work_instruction_id AND COALESCE(ci.field_type,'pass_fail')<>'heading') checklist_item_count ${orderJoins} WHERE ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    ),
    orderCounts(req),
  ])
  res.json({
    data: result.rows,
    meta: {
      page,
      pageSize,
      total: summary.total,
      summary,
      hasMore: page * pageSize < summary.total,
    },
  })
})
router.get('/summary', async (req: AuthRequest, res) => {
  res.json({ data: await orderCounts(req) })
})

router.patch('/:id/assignment', async (req: AuthRequest, res) => {
  const result = await query(
    "UPDATE public.work_orders SET assigned_to=$1 WHERE id=$2 AND tenant_id=$3 AND status='open' RETURNING *",
    [req.body.assignedTo || null, req.params.id, req.user!.tenantId],
  )
  if (!result.rows.length) {
    res
      .status(409)
      .json({ error: 'Only an accessible work order that has not started can be assigned' })
    return
  }
  res.json({ data: result.rows[0] })
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
      [req.params.id, req.user!.tenantId],
    )
    if (recordRes.rows.length === 0) {
      res.json({ data: null })
      return
    }

    const record = recordRes.rows[0]
    const findingsRes = await query(
      `SELECT id, result, notes, captured_value, photo_urls,
              ai_root_cause, ai_failure_class, ai_failure_code, ai_recommended_action,
              ai_validation_status, ai_validation_confidence, ai_validation_reason,
              ai_validation_recommended_result, ai_validation_evidence,
              checklist_item_id
       FROM public.inspection_findings
       WHERE inspection_record_id = $1
         AND tenant_id = $2
       ORDER BY created_at ASC`,
      [record.id, req.user!.tenantId],
    )

    const draft = await query(
      'SELECT version,answers FROM public.inspection_drafts WHERE record_id=$1 AND tenant_id=$2',
      [record.id, req.user!.tenantId],
    )
    res.json({
      data: { ...record, inspection_findings: findingsRes.rows, draft: draft.rows[0] || null },
    })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/draft', async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    await beginActorTransaction(client)
    const r = await client.query(
      'SELECT id,completed_at FROM public.inspection_records WHERE work_order_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [req.params.id, req.user!.tenantId],
    )
    if (!r.rows[0] || r.rows[0].completed_at) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Inspection unavailable or already signed' })
      return
    }
    const recordId = r.rows[0].id
    const old = await client.query(
      'SELECT version,answers FROM public.inspection_drafts WHERE record_id=$1',
      [recordId],
    )
    const version = old.rows[0]?.version || 0
    const q = await client.query(
      `SELECT ci.id FROM public.wi_checklist_items ci JOIN public.work_orders w ON w.work_instruction_id=ci.work_instruction_id WHERE w.id=$1 AND w.tenant_id=$2 AND ci.field_type<>'heading'`,
      [req.params.id, req.user!.tenantId],
    )
    let answers
    try {
      answers = normalizeAnswers(req.body.answers, new Set(q.rows.map((v: any) => v.id)))
    } catch (e) {
      await client.query('ROLLBACK')
      res.status(400).json({ error: (e as Error).message })
      return
    }
    if (
      req.body.version !== version &&
      !(
        req.body.version === version - 1 &&
        old.rows[0] &&
        canonicalJson(old.rows[0].answers) === canonicalJson(answers)
      )
    ) {
      await client.query('ROLLBACK')
      res
        .status(409)
        .json({
          error:
            'This inspection changed in another tab. Your input is retained. Reload the latest draft before editing.',
          conflict: true,
          version,
        })
      return
    }
    // Identical retries after a lost HTTP response are safe and do not add evidence.
    if (old.rows[0] && canonicalJson(old.rows[0].answers) === canonicalJson(answers)) {
      await client.query('COMMIT')
      res.json({ data: { version, answers } })
      return
    }
    const saved = await client.query(
      'INSERT INTO public.inspection_drafts(record_id,tenant_id,answers) VALUES($1,$2,$3::jsonb) ON CONFLICT(record_id) DO UPDATE SET answers=excluded.answers,version=inspection_drafts.version+1,updated_at=now() RETURNING version',
      [recordId, req.user!.tenantId, JSON.stringify(answers)],
    )
    await client.query('COMMIT')
    res.json({ data: { version: saved.rows[0].version } })
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(e)
  } finally {
    client.release()
  }
})
router.get('/:id/report.pdf', async (req: AuthRequest, res, next) => {
  try {
    const r = await query(
      'SELECT * FROM public.inspection_records WHERE work_order_id=$1 AND tenant_id=$2 AND completed_at IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [req.params.id, req.user!.tenantId],
    )
    if (!r.rows[0]) {
      res.status(404).json({ error: 'A completed, accessible inspection is required' })
      return
    }
    const pdf = await renderInspectionPdf(r.rows[0])
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="inspection-report.pdf"',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
      })
      .send(pdf)
  } catch (e) {
    next(e)
  }
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
        [req.params.id, req.user!.tenantId],
      ),
      query(
        `SELECT ci.*
         FROM   public.wi_checklist_items ci
         JOIN   public.work_orders wo ON wo.work_instruction_id = ci.work_instruction_id
         WHERE  wo.id = $1
           AND  wo.tenant_id = $2
         ORDER  BY ci.sort_order`,
        [req.params.id, req.user!.tenantId],
      ),
    ])

    if (woResult.rows.length === 0) {
      res.status(404).json({ error: 'Work order not found' })
      return
    }
    res.json({ data: { ...woResult.rows[0], checklist_items: itemsResult.rows } })
  } catch (err) {
    next(err)
  }
})

// POST /api/inspections - create work order
router.post('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { assetId, priority, dueDate, assignedTo, workInstructionId, notes } = req.body
    const allowedPriorities = new Set(['low', 'medium', 'high', 'critical'])
    const normalizedPriority = priority || 'medium'
    if (!assetId || typeof assetId !== 'string') {
      res.status(400).json({ error: 'A registered asset is required' })
      return
    }
    const assetRes = await query(
      `SELECT id, name, location, department_id FROM public.assets WHERE id = $1 AND tenant_id = $2`,
      [assetId, req.user!.tenantId],
    )
    if (assetRes.rows.length === 0) {
      res.status(400).json({ error: 'Asset must belong to your tenant' })
      return
    }
    const asset = assetRes.rows[0]
    if (!allowedPriorities.has(normalizedPriority)) {
      res.status(400).json({ error: 'Invalid work order priority' })
      return
    }
    if (assignedTo) {
      const userRes = await query(
        `SELECT id FROM public.users WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [assignedTo, req.user!.tenantId],
      )
      if (userRes.rows.length === 0) {
        res.status(400).json({ error: 'Assigned user must be active in your tenant' })
        return
      }
    }
    if (!workInstructionId) {
      res.status(400).json({ error: 'Work instruction is required for every work order' })
      return
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
         AND wi.status IN ('active','expiring')
         AND (wi.effective_date IS NULL OR wi.effective_date <= CURRENT_DATE)
         AND wi.department_id = $3
         AND (wi.expiry_date IS NULL OR wi.expiry_date >= CURRENT_DATE)
       GROUP BY wi.id`,
      [workInstructionId, req.user!.tenantId, asset.department_id],
    )
    if (wiRes.rows.length === 0) {
      res.status(400).json({ error: 'Work instruction must belong to your tenant' })
      return
    }
    if ((wiRes.rows[0].checkable_item_count ?? 0) < 1) {
      res.status(400).json({ error: 'Selected work instruction has no checklist items' })
      return
    }

    const client = await pool.connect()
    let workOrder: Record<string, any>
    try {
      await beginActorTransaction(client)
      // Serialize numbering per tenant so concurrent creates cannot receive the same WO number.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        req.user!.tenantId,
      ])
      const numberRes = await client.query(
        `SELECT COALESCE(MAX((substring(wo_number FROM '[0-9]+'))::int), 0) AS highest
         FROM public.work_orders WHERE tenant_id = $1`,
        [req.user!.tenantId],
      )
      const nextNumber = Number(numberRes.rows[0].highest) + 1
      const woNumber = `WO-${String(nextNumber).padStart(4, '0')}`
      const result = await client.query(
        `INSERT INTO public.work_orders
           (wo_number, tenant_id, asset_name, asset_record_id, location, priority, due_date, assigned_to, work_instruction_id, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)
         RETURNING *`,
        [
          woNumber,
          req.user!.tenantId,
          asset.name,
          asset.id,
          asset.location,
          normalizedPriority,
          dueDate || null,
          assignedTo || null,
          workInstructionId,
          notes || null,
          req.user!.id,
        ],
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
      detail: {
        wo_number: workOrder.wo_number,
        asset_name: workOrder.asset_name,
        asset_id: workOrder.asset_record_id,
      },
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
  } catch (err) {
    next(err)
  }
})

// PATCH /api/inspections/:id/work-instruction - attach or replace the inspection checklist
router.patch('/:id/work-instruction', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { workInstructionId } = req.body as { workInstructionId?: string }
    if (!workInstructionId) {
      res.status(400).json({ error: 'Work instruction is required' })
      return
    }

    const [woRes, wiRes] = await Promise.all([
      query(
        `SELECT id, wo_number, status
         FROM public.work_orders
         WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, req.user!.tenantId],
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
           AND wi.status IN ('active','expiring')
           AND (wi.effective_date IS NULL OR wi.effective_date <= CURRENT_DATE)
           AND (wi.expiry_date IS NULL OR wi.expiry_date >= CURRENT_DATE)
         GROUP BY wi.id, wi.wi_number`,
        [workInstructionId, req.user!.tenantId],
      ),
    ])

    if (woRes.rows.length === 0) {
      res.status(404).json({ error: 'Work order not found' })
      return
    }
    if (woRes.rows[0].status === 'complete') {
      res.status(409).json({ error: 'Completed work orders cannot be reassigned' })
      return
    }
    if (wiRes.rows.length === 0) {
      res.status(400).json({ error: 'Work instruction must belong to your tenant' })
      return
    }
    if ((wiRes.rows[0].checkable_item_count ?? 0) < 1) {
      res.status(400).json({ error: 'Selected work instruction has no checklist items' })
      return
    }

    const result = await query(
      `UPDATE public.work_orders
       SET work_instruction_id = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [workInstructionId, req.params.id, req.user!.tenantId],
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
  } catch (err) {
    next(err)
  }
})

// PATCH /api/inspections/:id/status
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body as { status: string }
    const allowedStatuses = new Set(['cancelled'])
    if (!allowedStatuses.has(status)) {
      res.status(400).json({ error: 'Invalid work order status' })
      return
    }
    const completed: string | null = null
    const result = await query(
      `UPDATE public.work_orders
       SET    status = $1, completed_at = $2, updated_at = NOW()
       WHERE  id = $3 AND tenant_id = $4
       RETURNING *`,
      [status, completed, req.params.id, req.user!.tenantId],
    )
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'work_order.status.updated',
      entityType: 'work_orders',
      entityId: req.params.id,
      detail: { status },
    })
    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
})

// POST /api/inspections/:id/start - create or resume an inspection record
router.post('/:id/start', requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { totalItems } = req.body
    await beginActorTransaction(client)

    const woRes = await client.query(
      `SELECT id, wo_number, asset_name, status, work_instruction_id
       FROM public.work_orders
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user!.tenantId],
    )
    if (woRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work order not found' })
      return
    }
    if (['complete', 'cancelled'].includes(woRes.rows[0].status)) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Closed work orders cannot be started' })
      return
    }
    if (!woRes.rows[0].work_instruction_id) {
      await client.query('ROLLBACK')
      res.status(409).json({
        error: 'Assign a work instruction with checklist items before starting this inspection',
      })
      return
    }
    const totalRes = await client.query(
      `SELECT COUNT(*)::int AS total_items
       FROM public.wi_checklist_items ci
       JOIN public.work_orders wo ON wo.work_instruction_id = ci.work_instruction_id
       WHERE wo.id = $1
         AND wo.tenant_id = $2
         AND ci.tenant_id = $2
         AND COALESCE(ci.field_type, 'pass_fail') <> 'heading'`,
      [req.params.id, req.user!.tenantId],
    )
    const serverTotalItems = totalRes.rows[0]?.total_items ?? totalItems ?? 0
    if (serverTotalItems < 1) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'The linked work instruction has no checklist items' })
      return
    }

    const existingRes = await client.query(
      `SELECT *
       FROM public.inspection_records
       WHERE work_order_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.params.id, req.user!.tenantId],
    )
    if (existingRes.rows[0]?.completed_at) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This work order already has a completed inspection' })
      return
    }

    let record = existingRes.rows[0]
    if (record) {
      const updatedRecordRes = await client.query(
        `UPDATE public.inspection_records
         SET total_items = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [serverTotalItems, record.id, req.user!.tenantId],
      )
      record = updatedRecordRes.rows[0]
    } else {
      record = (
        await client.query(
          `INSERT INTO public.inspection_records
           (work_order_id, inspector_id, tenant_id, total_items, started_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
          [req.params.id, req.user!.id, req.user!.tenantId, serverTotalItems],
        )
      ).rows[0]
    }

    await client.query(
      `UPDATE public.work_orders
       SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId],
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
    const {
      inspectionRecordId,
      checklistItemId,
      result: findingResult,
      notes,
      capturedValue,
    } = req.body
    if (!['pass', 'fail', 'na'].includes(findingResult)) {
      res.status(400).json({ error: 'Invalid finding result' })
      return
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
      [inspectionRecordId, req.params.id, req.user!.tenantId, checklistItemId],
    )
    if (belongsRes.rows.length === 0) {
      res.status(404).json({ error: 'Inspection record not found' })
      return
    }
    if (belongsRes.rows[0].completed_at) {
      res.status(409).json({ error: 'Completed inspections cannot be changed' })
      return
    }

    const result = await query(
      `INSERT INTO public.inspection_findings
         (inspection_record_id, checklist_item_id, result, notes, tenant_id, captured_value)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (inspection_record_id, checklist_item_id)
       DO UPDATE SET result = EXCLUDED.result, notes = EXCLUDED.notes, captured_value = EXCLUDED.captured_value, updated_at = NOW()
       RETURNING *`,
      [
        inspectionRecordId,
        checklistItemId,
        findingResult,
        notes || null,
        req.user!.tenantId,
        capturedValue ?? null,
      ],
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
  } catch (err) {
    next(err)
  }
})

// POST /api/inspections/:id/findings/photo - persist photo evidence for a finding
router.post('/:id/findings/photo', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { inspectionRecordId, checklistItemId, imageDataUrl } = req.body as {
      inspectionRecordId: string
      checklistItemId: string
      imageDataUrl: string
    }
    if (
      typeof imageDataUrl !== 'string' ||
      imageDataUrl.length > 2_800_000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageDataUrl)
    ) {
      res.status(400).json({ error: 'A base64 PNG, JPEG or WebP image under 2 MB is required' })
      return
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
      [inspectionRecordId, req.params.id, req.user!.tenantId, checklistItemId],
    )
    if (belongsRes.rows.length === 0) {
      res.status(404).json({ error: 'Inspection record not found' })
      return
    }
    if (belongsRes.rows[0].completed_at) {
      res.status(409).json({ error: 'Completed inspections cannot be changed' })
      return
    }

    const result = await query(
      `INSERT INTO public.inspection_findings
         (inspection_record_id, checklist_item_id, tenant_id, photo_urls)
       VALUES ($1, $2, $3, ARRAY[$4]::text[])
       ON CONFLICT (inspection_record_id, checklist_item_id)
       DO UPDATE SET photo_urls = array_append(COALESCE(public.inspection_findings.photo_urls, ARRAY[]::text[]), $4),
                     updated_at = NOW()
       RETURNING *`,
      [inspectionRecordId, checklistItemId, req.user!.tenantId, imageDataUrl],
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
  } catch (err) {
    next(err)
  }
})

// POST /api/inspections/:id/complete
router.post(['/:id/complete', '/:id/review'], requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { inspectionRecordId, signatureDataUrl } = req.body as {
      inspectionRecordId: string
      signatureDataUrl?: string
    }
    const reviewing = req.path.endsWith('/review')
    if (!reviewing && !validSignature(signatureDataUrl)) {
      res.status(400).json({ error: 'Signature is required to complete an inspection' })
      return
    }

    await beginActorTransaction(client)

    const recordRes = await client.query(
      `SELECT ir.*, wo.wo_number, wo.asset_name, wo.location, wo.assigned_to, wo.work_instruction_id, wo.asset_number_snapshot, wo.department_id, wo.department_name_snapshot,
              (SELECT revision FROM public.work_instructions WHERE id=wo.work_instruction_id) AS form_revision, (SELECT wi_number FROM public.work_instructions WHERE id=wo.work_instruction_id) AS form_reference, (SELECT title FROM public.work_instructions WHERE id=wo.work_instruction_id) AS form_title
       FROM public.inspection_records ir
       JOIN public.work_orders wo ON wo.id = ir.work_order_id
       WHERE ir.id = $1
         AND ir.work_order_id = $2
         AND ir.tenant_id = $3
         AND wo.tenant_id = $3
       FOR UPDATE`,
      [inspectionRecordId, req.params.id, req.user!.tenantId],
    )
    if (recordRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Inspection record not found' })
      return
    }
    const record = recordRes.rows[0]
    if (record.completed_at) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This inspection is already complete' })
      return
    }

    const draftRes = await client.query(
      'SELECT version,answers FROM public.inspection_drafts WHERE record_id=$1',
      [inspectionRecordId],
    )
    const draft = draftRes.rows[0]
    if (draft) {
      if (req.body.draftVersion !== draft.version) {
        await client.query('ROLLBACK')
        res
          .status(409)
          .json({ error: 'Draft changed. Save and review the latest responses before signing.' })
        return
      }
      for (const [qid, value] of Object.entries(draft.answers)) {
        const a = value as {
          result: string | null
          value: string
          notes: string
          naReason?: string
          photos: string[]
        }
        await client.query(
          `INSERT INTO public.inspection_findings(inspection_record_id,checklist_item_id,tenant_id,result,captured_value,notes,photo_urls) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(inspection_record_id,checklist_item_id) DO UPDATE SET result=excluded.result,captured_value=excluded.captured_value,notes=excluded.notes,photo_urls=excluded.photo_urls WHERE (inspection_findings.result,inspection_findings.captured_value,inspection_findings.notes,inspection_findings.photo_urls) IS DISTINCT FROM (excluded.result,excluded.captured_value,excluded.notes,excluded.photo_urls)`,
          [
            inspectionRecordId,
            qid,
            req.user!.tenantId,
            a.result,
            a.value,
            a.result === 'na' ? a.naReason || '' : a.notes,
            a.photos,
          ],
        )
      }
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
      [inspectionRecordId, req.params.id, req.user!.tenantId],
    )
    const counts = countRes.rows[0]
    if (
      counts.required_answered < counts.required_total ||
      counts.passed + counts.failed + counts.na < 1
    ) {
      await client.query('ROLLBACK')
      res.status(409).json({
        error: `Complete all required checklist items before signing (${counts.required_answered}/${counts.required_total} complete)`,
      })
      return
    }
    const overallResult = counts.failed > 0 ? 'fail' : counts.passed > 0 ? 'pass' : 'na'
    const snapshotRes = await client.query(
      `SELECT ci.id, ci.item_no, ci.description, ci.acceptance_criteria, ci.field_type,
              ci.min_value, ci.max_value, ci.unit, ci.category, ci.layout_json, ci.sort_order, ci.required, ci.options_json, ci.conditional_json, f.result, f.notes, f.captured_value, f.photo_urls
       FROM public.work_orders wo
       JOIN public.wi_checklist_items ci ON ci.work_instruction_id = wo.work_instruction_id AND ci.tenant_id = wo.tenant_id
       LEFT JOIN public.inspection_findings f ON f.checklist_item_id = ci.id AND f.inspection_record_id = $1
       WHERE wo.id = $2 AND wo.tenant_id = $3 ORDER BY ci.sort_order, ci.id`,
      [inspectionRecordId, req.params.id, req.user!.tenantId],
    )
    for (const item of snapshotRes.rows) {
      if (item.field_type === 'heading' || !item.result) continue
      const policy = item.conditional_json ? JSON.parse(item.conditional_json) : {}
      let issue = ''
      if (
        item.result === 'na' &&
        (item.required !== false || policy.naReasonRequired) &&
        !item.notes?.trim()
      )
        issue = 'N/A needs a reason'
      if (item.result !== 'na') {
        if (
          item.required !== false &&
          [
            'text',
            'textarea',
            'dropdown',
            'select',
            'yes_no',
            'date',
            'signature',
            'table',
            'multiselect',
            'checkbox',
          ].includes(item.field_type) &&
          !item.captured_value?.trim()
        )
          issue = 'A response is required'
        if (
          ['number', 'measurement'].includes(item.field_type) &&
          (!item.captured_value?.trim() || !Number.isFinite(Number(item.captured_value)))
        )
          issue = 'A numeric reading is required'
        if (item.result === 'fail' && policy.notesOnFail && !item.notes?.trim())
          issue = 'Failure notes are required'
        if (
          ((item.result === 'fail' && policy.photoOnFail) ||
            (item.field_type === 'photo' && item.required !== false)) &&
          !item.photo_urls?.length
        )
          issue = 'Photo evidence is required'
        if (
          item.field_type === 'signature' &&
          item.required !== false &&
          !validSignature(item.captured_value)
        )
          issue = 'A valid question signature is required'
        if (
          ['dropdown', 'select'].includes(item.field_type) &&
          item.captured_value &&
          !JSON.parse(item.options_json || '[]').includes(item.captured_value)
        )
          issue = 'Choose a listed response option'
        if (
          item.field_type === 'yes_no' &&
          item.required !== false &&
          !['Yes', 'No', 'yes', 'no'].includes(item.captured_value)
        )
          issue = 'Choose Yes or No'
        if (
          item.field_type === 'date' &&
          item.captured_value &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(item.captured_value) ||
            Number.isNaN(Date.parse(item.captured_value)) ||
            new Date(item.captured_value).toISOString().slice(0, 10) !== item.captured_value)
        )
          issue = 'A valid date is required'
        if (['multiselect', 'table'].includes(item.field_type) && item.required !== false) {
          try {
            const value = JSON.parse(item.captured_value || 'null')
            if (
              item.field_type === 'multiselect' &&
              (!Array.isArray(value) ||
                !value.length ||
                value.some((v) => !JSON.parse(item.options_json || '[]').includes(v)))
            )
              issue = 'Choose at least one listed response'
            if (
              item.field_type === 'table' &&
              (!value ||
                typeof value !== 'object' ||
                !Object.values(value).some((v) => String(v).trim()))
            )
              issue = 'Complete the response table'
          } catch {
            issue = 'A valid structured response is required'
          }
        }
      }
      if (issue) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Question ' + item.item_no + ': ' + issue })
        return
      }
    }
    if (draft)
      for (const item of snapshotRes.rows) {
        const a = draft.answers[item.id]
        if (a) {
          item.notes = a.notes
          item.na_reason = a.naReason || null
        }
      }
    const reviewToken = crypto
      .createHmac('sha256', process.env.JWT_SECRET!)
      .update(
        canonicalJson({ actor:req.user!.id,record: record.id, version: draft?.version || 0, items: snapshotRes.rows }),
      )
      .digest('hex')
    if (reviewing) {
      await client.query('COMMIT')
      res.json({
        data: { reviewToken, draftVersion: draft?.version || 0, items: snapshotRes.rows },
      })
      return
    }
    if (draft && req.body.reviewToken !== reviewToken) {
      await client.query('ROLLBACK')
      res
        .status(409)
        .json({ error: 'The reviewed state has changed. Return to review before signing.' })
      return
    }
    const signedPayload = {
      version: 3,
      workspaceName: req.user!.tenantName || 'Workspace not recorded',
      signerName: req.user!.name || 'Signer name not recorded',
      formReference: record.form_reference,
      formTitle: record.form_title,
      inspectionRecordId,
      signerId: req.user!.id,
      workInstructionId: record.work_instruction_id,
      formRevision: record.form_revision,
      workOrderNumber: record.wo_number,
      assetNumber: record.asset_number_snapshot,
      assetName: record.asset_name,
      departmentId: record.department_id,
      departmentName: record.department_name_snapshot,
      location: record.location,
      items: snapshotRes.rows,
      signatureDataUrl,
    }
    const signatureHash = crypto
      .createHash('sha256')
      .update(canonicalJson(signedPayload))
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
           signed_payload = $10::jsonb,
           updated_at = NOW()
       WHERE id = $9`,
      [
        overallResult,
        counts.passed,
        counts.failed,
        counts.na,
        counts.total_items,
        req.user!.id,
        signatureDataUrl,
        signatureHash,
        inspectionRecordId,
        JSON.stringify(signedPayload),
      ],
    )
    await client.query(
      `UPDATE public.work_orders
       SET status = 'complete', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId],
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
    [inspectionRecordId, tenantId],
  )
  const counts = countRes.rows[0]
  await query(
    `UPDATE public.inspection_records
     SET passed_items = $1, failed_items = $2, na_items = $3, total_items = $4, updated_at = NOW()
     WHERE id = $5 AND tenant_id = $6`,
    [counts.passed, counts.failed, counts.na, counts.total_items, inspectionRecordId, tenantId],
  )
}

export default router
