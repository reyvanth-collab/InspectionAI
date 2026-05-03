import { Router } from 'express'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'

const router = Router()

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
                field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json
         FROM public.wi_checklist_items
         WHERE work_instruction_id = $1
         ORDER BY sort_order`,
        [req.params.id]
      ),
      query(
        `SELECT * FROM public.wi_revision_history WHERE work_instruction_id = $1 ORDER BY effective_date DESC`,
        [req.params.id]
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
              field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json
       FROM public.wi_checklist_items
       WHERE work_instruction_id = $1
       ORDER BY sort_order`,
      [req.params.id]
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

    const wiResult = await query(
      `INSERT INTO public.work_instructions
         (wi_number, title, description, category, revision, status, effective_date, expiry_date, owner_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        status || 'draft',
        effectiveDate || null, expiryDate || null,
        req.user!.id, req.user!.tenantId,
      ]
    )
    const wi = wiResult.rows[0]

    if (checklistItems?.length) {
      await insertItems(wi.id, req.user!.tenantId, checklistItems)
    }

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

    const wiResult = await query(
      `UPDATE public.work_instructions
       SET    wi_number=$1, title=$2, description=$3, category=$4, revision=$5,
              status=$6, effective_date=$7, expiry_date=$8, updated_at=NOW()
       WHERE  id=$9 AND tenant_id=$10
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        status || 'draft',
        effectiveDate || null, expiryDate || null,
        req.params.id, req.user!.tenantId,
      ]
    )
    if (wiResult.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }

    // Replace all checklist items
    await query(`DELETE FROM public.wi_checklist_items WHERE work_instruction_id = $1`, [req.params.id])
    if (checklistItems?.length) {
      await insertItems(req.params.id, req.user!.tenantId, checklistItems)
    }

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
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// ── PATCH /api/work-instructions/:id/status ─────────────────────
router.patch('/:id/status', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { status } = req.body as { status: string }
    const result = await query(
      `UPDATE public.work_instructions SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [status, req.params.id, req.user!.tenantId]
    )
    if (result.rows.length === 0) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ data: result.rows[0] })
  } catch (err) { next(err) }
})

// ── POST /api/work-instructions/:id/submit-approval ─────────────
router.post('/:id/submit-approval', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { approverIds } = req.body as { approverIds: string[] }
    const wiId = req.params.id

    // Create approval workflow record
    const approvalRes = await query(
      `INSERT INTO public.approval_workflows (work_instruction_id, tenant_id, submitted_by, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [wiId, req.user!.tenantId, req.user!.id]
    )
    const workflowId = approvalRes.rows[0].id

    // Create one step per approver
    for (let i = 0; i < approverIds.length; i++) {
      await query(
        `INSERT INTO public.approval_steps (workflow_id, approver_id, step_order, status)
         VALUES ($1, $2, $3, 'pending')`,
        [workflowId, approverIds[i], i + 1]
      )
    }

    // Update WI status to under_review
    await query(
      `UPDATE public.work_instructions SET status = 'under_review' WHERE id = $1 AND tenant_id = $2`,
      [wiId, req.user!.tenantId]
    )

    res.json({ data: { workflowId } })
  } catch (err) { next(err) }
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
  sortOrder:           number
}

async function insertItems(wiId: string, tenantId: string, items: ChecklistItemInput[]) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders = chunk.map((item, j) => {
      const b = j * 15
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
        item.sortOrder,
      )
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15})`
    }).join(',')

    await query(
      `INSERT INTO public.wi_checklist_items
         (work_instruction_id, tenant_id, item_no, description, acceptance_criteria, category,
          field_type, required, placeholder, options_json, unit, min_value, max_value,
          conditional_json, sort_order)
       VALUES ${placeholders}`,
      values
    )
  }
}

export default router
