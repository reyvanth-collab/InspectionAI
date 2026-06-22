import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { pool, query } from '../lib/db'
import { auditLog, notifyUsers } from '../lib/events'

const router = Router()
const WI_STATUSES = new Set(['draft', 'pending_approval', 'active', 'expiring', 'expired', 'superseded'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── Auto-migrate: add field-builder columns to wi_checklist_items ──
;(async () => {
  try {
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS field_type     TEXT    DEFAULT 'pass_fail'`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS placeholder    TEXT`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS options_json   TEXT`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS unit           TEXT`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS min_value      NUMERIC`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS max_value      NUMERIC`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS conditional_json TEXT`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS source_page INTEGER`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS source_text TEXT`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC`)
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS ai_warnings TEXT[]`)
  } catch (e) {
    console.warn('[wi] column migration warning:', (e as Error).message)
  }
})()

// ── GET /api/work-instructions ───────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { search } = req.query
    let sql = `
      SELECT wi.id, wi.wi_number, wi.title, wi.category, wi.revision,
             wi.status, wi.effective_date, wi.expiry_date,
             u.name AS owner_name
      FROM   public.work_instructions wi
      LEFT JOIN public.users u ON u.id = wi.owner_id
      WHERE  wi.tenant_id = $1`
    const params: unknown[] = [req.user!.tenantId]

    if (search) {
      params.push(`%${search}%`)
      sql += ` AND (wi.title ILIKE $${params.length} OR wi.wi_number ILIKE $${params.length})`
    }
    sql += ` ORDER BY wi.expiry_date ASC NULLS LAST LIMIT 200`

    const result = await query(sql, params)
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// ── GET /api/work-instructions/:id ──────────────────────────────
router.get('/:id', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [wiRes, itemsRes, historyRes] = await Promise.all([
      query(
        `SELECT wi.*, u.name AS owner_name, u.email AS owner_email
         FROM   public.work_instructions wi
         LEFT JOIN public.users u ON u.id = wi.owner_id
         WHERE  wi.id = $1 AND wi.tenant_id = $2`,
        [req.params.id, req.user!.tenantId]
      ),
      query(
        `SELECT id, item_no, description, acceptance_criteria, category, sort_order,
                field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json,
                source_page, source_text, ai_confidence, ai_warnings
         FROM public.wi_checklist_items
         WHERE work_instruction_id = $1
           AND tenant_id = $2
         ORDER BY sort_order`,
        [req.params.id, req.user!.tenantId]
      ),
      query(
        `SELECT *
         FROM public.wi_revision_history
         WHERE work_instruction_id = $1
           AND tenant_id = $2
         ORDER BY effective_date DESC`,
        [req.params.id, req.user!.tenantId]
      ),
    ])

    if (wiRes.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    res.json({
      data: {
        ...wiRes.rows[0],
        wi_checklist_items:  itemsRes.rows,
        wi_revision_history: historyRes.rows,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /api/work-instructions/:id/items ────────────────────────
router.get('/:id/items', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, item_no, description, acceptance_criteria, category, sort_order,
              field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json,
              source_page, source_text, ai_confidence, ai_warnings
       FROM public.wi_checklist_items
       WHERE work_instruction_id = $1
         AND tenant_id = $2
       ORDER BY sort_order`,
      [req.params.id, req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// ── POST /api/work-instructions ─────────────────────────────────
// Creates a new WI and optionally inserts checklist items in the same request.
router.post('/', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const {
      wiNumber, title, description, category, revision,
      effectiveDate, expiryDate, status, checklistItems,
    } = req.body as {
      wiNumber: string; title: string; description?: string; category?: string
      revision: string; effectiveDate?: string; expiryDate?: string
      status?: string
      checklistItems?: ChecklistItemInput[]
    }
    const normalizedStatus = status || 'draft'
    if (!WI_STATUSES.has(normalizedStatus)) {
      res.status(400).json({ error: 'Invalid work instruction status' }); return
    }

    const wiResult = await query(
      `INSERT INTO public.work_instructions
         (wi_number, title, description, category, revision, status, effective_date, expiry_date, owner_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        normalizedStatus,
        effectiveDate || null, expiryDate || null,
        req.user!.id, req.user!.tenantId,
      ]
    )
    const wi = wiResult.rows[0]

    if (checklistItems?.length) {
      await insertItems(wi.id, req.user!.tenantId, checklistItems)
    }

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.created',
      entityType: 'work_instructions',
      entityId: wi.id,
      detail: { wi_number: wi.wi_number, revision: wi.revision, status: wi.status },
    })

    res.status(201).json({ data: wi })
  } catch (err) { next(err) }
})

// ── PUT /api/work-instructions/:id ──────────────────────────────
// Full replacement: update metadata + delete-all + re-insert items.
router.put('/:id', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const {
      wiNumber, title, description, category, revision,
      effectiveDate, expiryDate, status, checklistItems,
    } = req.body as {
      wiNumber: string; title: string; description?: string; category?: string
      revision: string; effectiveDate?: string; expiryDate?: string
      status?: string
      checklistItems?: ChecklistItemInput[]
    }
    const normalizedStatus = status || 'draft'
    if (!WI_STATUSES.has(normalizedStatus)) {
      res.status(400).json({ error: 'Invalid work instruction status' }); return
    }

    const wiResult = await query(
      `UPDATE public.work_instructions
       SET    wi_number=$1, title=$2, description=$3, category=$4, revision=$5,
              status=$6, effective_date=$7, expiry_date=$8, updated_at=NOW()
       WHERE  id=$9 AND tenant_id=$10
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        normalizedStatus,
        effectiveDate || null, expiryDate || null,
        req.params.id, req.user!.tenantId,
      ]
    )
    if (wiResult.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }

    // Replace all checklist items
    await query(
      `DELETE FROM public.wi_checklist_items WHERE work_instruction_id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    )
    if (checklistItems?.length) {
      await insertItems(req.params.id, req.user!.tenantId, checklistItems)
    }

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.updated',
      entityType: 'work_instructions',
      entityId: req.params.id,
      detail: {
        wi_number: wiResult.rows[0].wi_number,
        revision: wiResult.rows[0].revision,
        status: wiResult.rows[0].status,
      },
    })

    res.json({ data: wiResult.rows[0] })
  } catch (err) { next(err) }
})

// ── PATCH /api/work-instructions/:id ────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { title, description, category, revision, effectiveDate, expiryDate } = req.body
    const result = await query(
      `UPDATE public.work_instructions
       SET    title=$1, description=$2, category=$3, revision=$4,
              effective_date=$5, expiry_date=$6, updated_at=NOW()
       WHERE  id=$7 AND tenant_id=$8
       RETURNING *`,
      [title, description || null, category || null, revision,
       effectiveDate || null, expiryDate || null, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.updated',
      entityType: 'work_instructions',
      entityId: req.params.id,
      detail: { title, category, revision },
    })
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// ── PATCH /api/work-instructions/:id/status ─────────────────────
router.patch('/:id/status', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body as { status: string }
    if (!WI_STATUSES.has(status)) {
      res.status(400).json({ error: 'Invalid work instruction status' }); return
    }
    const result = await query(
      `UPDATE public.work_instructions SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [status, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.status.updated',
      entityType: 'work_instructions',
      entityId: req.params.id,
      detail: { status },
    })
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// ── POST /api/work-instructions/:id/submit-approval ─────────────
router.post('/:id/submit-approval', requireAuth, async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { approverIds } = req.body as { approverIds: string[] }
    const wiId = req.params.id
    const submittedApproverIds = Array.isArray(approverIds) ? approverIds : []
    const uniqueApproverIds = [...new Set(submittedApproverIds.filter(Boolean))]
    if (uniqueApproverIds.length === 0) {
      res.status(400).json({ error: 'At least one approver is required' }); return
    }
    if (uniqueApproverIds.some(id => !UUID_RE.test(id))) {
      res.status(400).json({ error: 'Approver IDs must be valid UUIDs' }); return
    }

    const approverRes = await query(
      `SELECT id
       FROM public.users
       WHERE tenant_id = $1
         AND active = true
         AND lower(role::text) IN ('admin', 'approver')
         AND id = ANY($2::uuid[])`,
      [req.user!.tenantId, uniqueApproverIds]
    )
    const validApproverIds = new Set(approverRes.rows.map(row => row.id))
    if (uniqueApproverIds.some(id => !validApproverIds.has(id))) {
      res.status(400).json({ error: 'Approvers must be active admin or approver users in your tenant' }); return
    }

    await client.query('BEGIN')

    const wiRes = await client.query(
      `SELECT id, wi_number, title, revision, status
       FROM public.work_instructions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [wiId, req.user!.tenantId]
    )
    if (wiRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found' }); return
    }

    const activeRes = await client.query(
      `SELECT id
       FROM public.approval_records
       WHERE work_instruction_id = $1
         AND tenant_id = $2
         AND final_status = 'active'
       LIMIT 1`,
      [wiId, req.user!.tenantId]
    )
    if (activeRes.rows.length > 0) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'This work instruction is already awaiting approval' }); return
    }

    const approvalRes = await client.query(
      `INSERT INTO public.approval_records
         (work_instruction_id, tenant_id, submitted_by, current_step, final_status)
       VALUES ($1, $2, $3, 1, 'active')
       RETURNING id`,
      [wiId, req.user!.tenantId, req.user!.id]
    )
    const approvalRecordId = approvalRes.rows[0].id as string

    for (let i = 0; i < uniqueApproverIds.length; i++) {
      const label = i === 0
        ? 'Technical Check'
        : i === uniqueApproverIds.length - 1
        ? 'Final Approval'
        : `Review ${i + 1}`
      await client.query(
        `INSERT INTO public.approval_steps
           (approval_record_id, tenant_id, step_number, label, approver_id, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [approvalRecordId, req.user!.tenantId, i + 1, label, uniqueApproverIds[i], i === 0 ? 'active' : 'wait']
      )
    }

    await client.query(
      `UPDATE public.work_instructions
       SET status = 'pending_approval', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [wiId, req.user!.tenantId]
    )

    await client.query('COMMIT')

    const wi = wiRes.rows[0]
    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.submitted_for_approval',
      entityType: 'approval_records',
      entityId: approvalRecordId,
      detail: { wi_number: wi.wi_number, revision: wi.revision, approver_count: uniqueApproverIds.length },
    })
    await notifyUsers(req.user!.tenantId, [uniqueApproverIds[0]], {
      title: `Approval Required - ${wi.wi_number}`,
      message: `${wi.title} ${wi.revision} is awaiting your approval.`,
      severity: 'info',
      entityType: 'approval_records',
      entityId: approvalRecordId,
    })

    res.json({ data: { approvalRecordId } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// ── Helpers ──────────────────────────────────────────────────────
interface ChecklistItemInput {
  itemNo:              string
  description:         string
  acceptanceCriteria?: string
  category?:           string
  fieldType?:          string
  required?:           boolean
  placeholder?:        string
  optionsJson?:        string
  unit?:               string
  minValue?:           number | null
  maxValue?:           number | null
  conditionalJson?:    string
  sourcePage?:         number | null
  sourceText?:         string | null
  aiConfidence?:       number | null
  aiWarnings?:         string[] | null
  sortOrder:           number
}

async function insertItems(wiId: string, tenantId: string, items: ChecklistItemInput[]) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders = chunk.map((item, j) => {
      const b = j * 19
      values.push(
        wiId, tenantId,
        item.itemNo, item.description, item.acceptanceCriteria || null,
        item.category || null,
        item.fieldType || 'pass_fail',
        item.required ?? true,
        item.placeholder || null,
        item.optionsJson || null,
        item.unit || null,
        item.minValue ?? null,
        item.maxValue ?? null,
        item.conditionalJson || null,
        item.sourcePage ?? null,
        item.sourceText || null,
        item.aiConfidence ?? null,
        item.aiWarnings?.length ? item.aiWarnings : null,
        item.sortOrder,
      )
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19})`
    }).join(',')

    await query(
      `INSERT INTO public.wi_checklist_items
         (work_instruction_id, tenant_id, item_no, description, acceptance_criteria, category,
          field_type, required, placeholder, options_json, unit, min_value, max_value,
          conditional_json, source_page, source_text, ai_confidence, ai_warnings, sort_order)
       VALUES ${placeholders}`,
      values
    )
  }
}

export default router
