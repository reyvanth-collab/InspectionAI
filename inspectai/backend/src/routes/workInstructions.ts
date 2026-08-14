import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { pool, query } from '../lib/db'
import { auditLog, notifyUsers } from '../lib/events'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const WI_STATUSES = new Set(['draft', 'pending_approval', 'active', 'expiring', 'expired', 'superseded'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELD_TYPES = new Set(['heading', 'pass_fail', 'text', 'number', 'dropdown', 'yes_no', 'multiselect', 'date', 'measurement', 'photo', 'textarea', 'signature', 'table'])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMPTY_DATE_TEXT = /^(n\/a|na|nil|none|null|unknown|not stated|not stated in source|not mentioned|not available|not applicable)$/i

function normalizeDateInput(value: unknown) {
  if (value == null) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const text = String(value).trim()
  if (!text || EMPTY_DATE_TEXT.test(text)) return null
  if (ISO_DATE_RE.test(text)) return text
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return null
}

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
    await query(`ALTER TABLE public.wi_checklist_items ADD COLUMN IF NOT EXISTS layout_json TEXT`)
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
             u.name AS owner_name,
             COUNT(ci.id)::int AS checklist_item_count,
             COUNT(ci.id) FILTER (
               WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
             )::int AS checkable_item_count
      FROM   public.work_instructions wi
      LEFT JOIN public.users u ON u.id = wi.owner_id
      LEFT JOIN public.wi_checklist_items ci
        ON ci.work_instruction_id = wi.id
       AND ci.tenant_id = wi.tenant_id
      WHERE  wi.tenant_id = $1`
    const params: unknown[] = [req.user!.tenantId]

    if (search) {
      params.push(`%${search}%`)
      sql += ` AND (wi.title ILIKE $${params.length} OR wi.wi_number ILIKE $${params.length})`
    }
    sql += `
      GROUP BY wi.id, wi.wi_number, wi.title, wi.category, wi.revision,
               wi.status, wi.effective_date, wi.expiry_date, u.name
      ORDER BY wi.expiry_date ASC NULLS LAST
      LIMIT 200`

    const result = await query(sql, params)
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

// ── GET /api/work-instructions/:id ──────────────────────────────
router.get('/template', requireAuth, requireRole('admin', 'approver'), async (_req: AuthRequest, res, next) => {
  try {
    const wb = XLSX.utils.book_new()
    const metaRows = [
      { Field: 'WI Number', Value: 'WI-EL-001' },
      { Field: 'Title', Value: 'Escalator Monthly Preventive Maintenance' },
      { Field: 'Revision', Value: 'Rev 1' },
      { Field: 'Category', Value: 'Escalator' },
      { Field: 'Effective Date', Value: '2026-08-12' },
      { Field: 'Expiry Date', Value: '2027-08-12' },
    ]
    const checklistRows = [
      {
        'Item No': '1',
        'Field Type': 'heading',
        'Question / Heading': 'Pre-check',
        'Acceptance Criteria': '',
        Required: 'No',
        Width: 'full',
        Height: 56,
        'Section Level': 1,
        Rows: '',
        'Table Columns': '',
        Options: '',
        Unit: '',
        Min: '',
        Max: '',
        Placeholder: '',
      },
      {
        'Item No': '2',
        'Field Type': 'pass_fail',
        'Question / Heading': 'Asset tag and location match the work order',
        'Acceptance Criteria': 'Asset identifier and location are correct.',
        Required: 'Yes',
        Width: 'full',
        Height: 88,
        'Section Level': '',
        Rows: '',
        'Table Columns': '',
        Options: '',
        Unit: '',
        Min: '',
        Max: '',
        Placeholder: '',
      },
      {
        'Item No': '3',
        'Field Type': 'measurement',
        'Question / Heading': 'Record comb plate clearance',
        'Acceptance Criteria': 'Clearance is within approved range.',
        Required: 'Yes',
        Width: 'half',
        Height: 88,
        'Section Level': '',
        Rows: '',
        'Table Columns': '',
        Options: '',
        Unit: 'mm',
        Min: 0,
        Max: 6,
        Placeholder: '',
      },
      {
        'Item No': '4',
        'Field Type': 'table',
        'Question / Heading': 'Component condition table',
        'Acceptance Criteria': '',
        Required: 'Yes',
        Width: 'full',
        Height: 180,
        'Section Level': '',
        Rows: 4,
        'Table Columns': 'Component\nCondition\nResult\nRemarks',
        Options: '',
        Unit: '',
        Min: '',
        Max: '',
        Placeholder: '',
      },
    ]
    const readmeRows = [
      { Notes: 'Use the Work Instruction sheet for metadata.' },
      { Notes: 'Use the Checklist sheet for one field per row. Preserve the column headers.' },
      { Notes: 'Field Type values: heading, pass_fail, text, number, dropdown, yes_no, multiselect, date, measurement, photo, textarea, signature, table.' },
      { Notes: 'Width values: full, half, third. Max three third-width items can share a row.' },
      { Notes: 'For table fields, put one table column per line in Table Columns and set Rows.' },
      { Notes: 'For dropdown or multiselect, put one option per line in Options.' },
    ]

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), 'Work Instruction')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checklistRows), 'Checklist')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(readmeRows), 'README')
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="inspectai-wi-template.xlsx"')
    res.send(buffer)
  } catch (err) { next(err) }
})

router.post(
  '/import-excel',
  requireAuth,
  requireRole('admin', 'approver'),
  upload.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No Excel file uploaded' }); return }
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
      const metaSheet = wb.Sheets['Work Instruction'] ?? wb.Sheets['Metadata'] ?? wb.Sheets[wb.SheetNames[0]]
      const checklistSheet = wb.Sheets['Checklist'] ?? wb.Sheets['Items'] ?? wb.Sheets[wb.SheetNames[1] ?? wb.SheetNames[0]]
      if (!metaSheet || !checklistSheet) {
        res.status(422).json({ error: 'Workbook must include Work Instruction and Checklist sheets' }); return
      }

      const meta = parseWiExcelMeta(metaSheet)
      const items = parseWiExcelItems(checklistSheet)
      if (!items.length) {
        res.status(422).json({ error: 'No checklist rows found. Fill the Checklist sheet before importing.' }); return
      }

      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'wi.excel.imported',
        entityType: 'work_instructions',
        detail: { file_name: req.file.originalname, wi_number: meta.wiNumber, item_count: items.length },
      })

      res.json({ data: { ...meta, items } })
    } catch (err) { next(err) }
  }
)

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
                source_page, source_text, ai_confidence, ai_warnings, layout_json
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
              source_page, source_text, ai_confidence, ai_warnings, layout_json
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
  const client = await pool.connect()
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
    if (normalizedStatus !== 'draft') {
      res.status(409).json({ error: 'Work instructions must be saved as draft and submitted through approval before activation' }); return
    }
    const safeEffectiveDate = normalizeDateInput(effectiveDate)
    const safeExpiryDate = normalizeDateInput(expiryDate)

    await client.query('BEGIN')

    const existingDraftRes = await client.query(
      `SELECT id, status
       FROM public.work_instructions
       WHERE tenant_id = $1 AND wi_number = $2 AND revision = $3
       FOR UPDATE
       LIMIT 1`,
      [req.user!.tenantId, wiNumber, revision]
    )
    if (existingDraftRes.rows.length > 0) {
      const existing = existingDraftRes.rows[0]
      if (existing.status !== 'draft') {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'This WI number and revision already exists and is not an editable draft' }); return
      }
      const updateRes = await client.query(
        `UPDATE public.work_instructions
         SET title=$1, description=$2, category=$3, status='draft',
             effective_date=$4, expiry_date=$5, updated_at=NOW()
         WHERE id=$6 AND tenant_id=$7
         RETURNING *`,
        [
          title,
          description || null,
          category || null,
          safeEffectiveDate,
          safeExpiryDate,
          existing.id,
          req.user!.tenantId,
        ]
      )
      await client.query(
        `DELETE FROM public.wi_checklist_items WHERE work_instruction_id = $1 AND tenant_id = $2`,
        [existing.id, req.user!.tenantId]
      )
      if (checklistItems?.length) {
        await insertItems(existing.id, req.user!.tenantId, checklistItems, (text, params) => client.query(text, params))
      }
      await client.query('COMMIT')
      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'wi.draft.recovered',
        entityType: 'work_instructions',
        entityId: existing.id,
        detail: { wi_number: wiNumber, revision },
      })
      res.json({ data: updateRes.rows[0] }); return
    }

    const wiResult = await client.query(
      `INSERT INTO public.work_instructions
         (wi_number, title, description, category, revision, status, effective_date, expiry_date, owner_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        normalizedStatus,
        safeEffectiveDate, safeExpiryDate,
        req.user!.id, req.user!.tenantId,
      ]
    )
    const wi = wiResult.rows[0]

    if (checklistItems?.length) {
      await insertItems(wi.id, req.user!.tenantId, checklistItems, (text, params) => client.query(text, params))
    }

    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.created',
      entityType: 'work_instructions',
      entityId: wi.id,
      detail: { wi_number: wi.wi_number, revision: wi.revision, status: wi.status },
    })

    res.status(201).json({ data: wi })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// ── PUT /api/work-instructions/:id ──────────────────────────────
// Full replacement: update metadata + delete-all + re-insert items.
router.put('/:id', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
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
    if (normalizedStatus !== 'draft') {
      res.status(409).json({ error: 'Work instructions must remain draft until submitted and approved through the approval workflow' }); return
    }
    const safeEffectiveDate = normalizeDateInput(effectiveDate)
    const safeExpiryDate = normalizeDateInput(expiryDate)

    await client.query('BEGIN')

    const currentRes = await client.query(
      `SELECT id, status
       FROM public.work_instructions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user!.tenantId]
    )
    if (currentRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Not found' }); return
    }
    if (currentRes.rows[0].status !== 'draft') {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Only draft work instructions can be edited. Create a revision for an approved WI.' }); return
    }

    const wiResult = await client.query(
      `UPDATE public.work_instructions
       SET    wi_number=$1, title=$2, description=$3, category=$4, revision=$5,
              status=$6, effective_date=$7, expiry_date=$8, updated_at=NOW()
       WHERE  id=$9 AND tenant_id=$10
       RETURNING *`,
      [
        wiNumber, title, description || null, category || null, revision,
        normalizedStatus,
        safeEffectiveDate, safeExpiryDate,
        req.params.id, req.user!.tenantId,
      ]
    )
    if (wiResult.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Not found' }); return
    }

    // Replace all checklist items
    await client.query(
      `DELETE FROM public.wi_checklist_items WHERE work_instruction_id = $1 AND tenant_id = $2`,
      [req.params.id, req.user!.tenantId]
    )
    if (checklistItems?.length) {
      await insertItems(req.params.id, req.user!.tenantId, checklistItems, (text, params) => client.query(text, params))
    }

    await client.query('COMMIT')

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
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// ── PATCH /api/work-instructions/:id ────────────────────────────
router.patch('/:id', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  try {
    const { title, description, category, revision, effectiveDate, expiryDate } = req.body
    const safeEffectiveDate = normalizeDateInput(effectiveDate)
    const safeExpiryDate = normalizeDateInput(expiryDate)
    const result = await query(
      `UPDATE public.work_instructions
       SET    title=$1, description=$2, category=$3, revision=$4,
              effective_date=$5, expiry_date=$6, updated_at=NOW()
       WHERE  id=$7 AND tenant_id=$8
       RETURNING *`,
      [title, description || null, category || null, revision,
       safeEffectiveDate, safeExpiryDate, req.params.id, req.user!.tenantId]
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
    if (status === 'active' || status === 'pending_approval') {
      res.status(409).json({ error: 'Use the approval workflow to submit or activate a work instruction' }); return
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
router.post('/:id/revisions', requireAuth, requireRole('admin', 'approver'), async (req: AuthRequest, res, next) => {
  const client = await pool.connect()
  try {
    const { changeSummary } = req.body as { changeSummary?: string }

    await client.query('BEGIN')

    const sourceRes = await client.query(
      `SELECT *
       FROM public.work_instructions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [req.params.id, req.user!.tenantId]
    )
    if (sourceRes.rows.length === 0) {
      await client.query('ROLLBACK')
      res.status(404).json({ error: 'Work instruction not found' }); return
    }

    const source = sourceRes.rows[0]
    if (!['active', 'expiring', 'expired', 'superseded'].includes(source.status)) {
      await client.query('ROLLBACK')
      res.status(409).json({ error: 'Create a revision only from an approved work instruction' }); return
    }

    const revisionsRes = await client.query(
      `SELECT revision
       FROM public.work_instructions
       WHERE tenant_id = $1 AND wi_number = $2`,
      [req.user!.tenantId, source.wi_number]
    )
    const nextRevision = getNextRevision(revisionsRes.rows.map(row => String(row.revision)))

    const newWiRes = await client.query(
      `INSERT INTO public.work_instructions
         (wi_number, title, description, category, revision, status, effective_date, expiry_date,
          owner_id, tenant_id, pdf_url, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',NULL,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        source.wi_number,
        source.title,
        source.description,
        source.category,
        nextRevision,
        source.expiry_date,
        req.user!.id,
        req.user!.tenantId,
        source.pdf_url,
        req.user!.id,
      ]
    )
    const newWi = newWiRes.rows[0]

    await client.query(
      `INSERT INTO public.wi_checklist_items
         (tenant_id, work_instruction_id, item_no, description, acceptance_criteria, category,
          required, field_type, placeholder, options_json, unit, min_value, max_value,
          conditional_json, source_page, source_text, ai_confidence, ai_warnings, layout_json, sort_order)
       SELECT tenant_id, $1, item_no, description, acceptance_criteria, category,
              required, field_type, placeholder, options_json, unit, min_value, max_value,
              conditional_json, source_page, source_text, ai_confidence, ai_warnings, layout_json, sort_order
       FROM public.wi_checklist_items
       WHERE work_instruction_id = $2
         AND tenant_id = $3
       ORDER BY sort_order`,
      [newWi.id, source.id, req.user!.tenantId]
    )

    await client.query(
      `INSERT INTO public.wi_revision_history
         (tenant_id, work_instruction_id, revision, change_summary, approved_by, effective_date)
       VALUES ($1,$2,$3,$4,NULL,NULL)`,
      [
        req.user!.tenantId,
        newWi.id,
        nextRevision,
        changeSummary?.trim() || `Draft revision created from ${source.revision}`,
      ]
    )

    await client.query('COMMIT')

    await auditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.id,
      action: 'wi.revision.created',
      entityType: 'work_instructions',
      entityId: newWi.id,
      detail: { wi_number: newWi.wi_number, from_revision: source.revision, revision: nextRevision },
    })

    res.status(201).json({ data: newWi })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

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
    const wi = wiRes.rows[0]
    if (wi.status !== 'draft') {
      await client.query('ROLLBACK')
      const message = wi.status === 'pending_approval'
        ? 'This work instruction is already submitted and awaiting approval'
        : 'Only draft work instructions can be submitted for approval. Create a revision before changing an approved WI.'
      res.status(409).json({ error: message, status: wi.status }); return
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

    const statusRes = await client.query(
      `UPDATE public.work_instructions
       SET status = 'pending_approval', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING status`,
      [wiId, req.user!.tenantId]
    )

    await client.query('COMMIT')

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

    res.json({ data: { approvalRecordId, status: statusRes.rows[0]?.status ?? 'pending_approval' } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    next(err)
  } finally {
    client.release()
  }
})

// ── Helpers ──────────────────────────────────────────────────────
function clean(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).trim()
}

function pick(row: Record<string, unknown>, keys: string[]) {
  const found = keys.find(key => row[key] != null && clean(row[key]) !== '')
  return found ? clean(row[found]) : ''
}

function parseBool(value: unknown, fallback = true) {
  const text = clean(value).toLowerCase()
  if (!text) return fallback
  return ['yes', 'y', 'true', '1', 'required'].includes(text)
}

function parseNumber(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(clean(value))
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

function normalizeFieldType(value: unknown) {
  const normalized = clean(value).toLowerCase().replace(/[\s/-]+/g, '_')
  if (FIELD_TYPES.has(normalized)) return normalized
  if (['passfail', 'ok_nok', 'oknok', 'ok_nok_na'].includes(normalized)) return 'pass_fail'
  if (['long_text', 'notes', 'remark', 'remarks'].includes(normalized)) return 'textarea'
  if (['section', 'section_heading', 'partition'].includes(normalized)) return 'heading'
  return 'pass_fail'
}

function normalizeWidth(value: unknown) {
  const width = clean(value).toLowerCase()
  return width === 'half' || width === 'third' ? width : 'full'
}

function parseWiExcelMeta(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const meta: Record<string, string> = {}

  rows.forEach(row => {
    const field = clean(row.Field ?? row.Key ?? row.Name).toLowerCase()
    const value = clean(row.Value ?? row.Data)
    if (field) meta[field] = value
  })

  const first = rows[0] ?? {}
  return {
    wiTitle:       meta.title || pick(first, ['Title', 'WI Title', 'Work Instruction Title']) || 'New Work Instruction',
    wiNumber:      meta['wi number'] || meta.wi_number || pick(first, ['WI Number', 'wi_number', 'WI_Number']) || '',
    revision:      meta.revision || pick(first, ['Revision']) || 'Rev 1',
    category:      meta.category || pick(first, ['Category']) || '',
    effectiveDate: meta['effective date'] || meta.effective_date || pick(first, ['Effective Date', 'effective_date']) || '',
    expiryDate:    meta['expiry date'] || meta.expiry_date || pick(first, ['Expiry Date', 'expiry_date', 'Expires']) || '',
  }
}

function parseWiExcelItems(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return rows
    .map((row, idx) => {
      const description = pick(row, ['Question / Heading', 'Question', 'Description', 'Label', 'Task'])
      const fieldType = normalizeFieldType(pick(row, ['Field Type', 'fieldType', 'Type', 'Control Type']))
      const tableColumns = pick(row, ['Table Columns', 'Columns'])
        .split(/\r?\n|,/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 8)
      const options = pick(row, ['Options', 'Dropdown Options', 'Choices'])
        .split(/\r?\n|,/)
        .map(s => s.trim())
        .filter(Boolean)

      return {
        itemNo:             pick(row, ['Item No', 'ItemNo', 'No', 'Step No']) || String(idx + 1),
        description,
        fieldType,
        acceptanceCriteria: pick(row, ['Acceptance Criteria', 'Criteria', 'Pass Criteria']) || null,
        required:           fieldType !== 'heading' && parseBool(row.Required, true),
        placeholder:        pick(row, ['Placeholder', 'Hint']),
        options,
        unit:               pick(row, ['Unit', 'UOM']),
        minValue:           pick(row, ['Min', 'Min Value']) ? Number(pick(row, ['Min', 'Min Value'])) : null,
        maxValue:           pick(row, ['Max', 'Max Value']) ? Number(pick(row, ['Max', 'Max Value'])) : null,
        layout: {
          width:          normalizeWidth(pick(row, ['Width', 'Field Width'])),
          height:         parseNumber(pick(row, ['Height']), fieldType === 'table' ? 180 : 88, 48, 360),
          sectionLevel:   parseNumber(pick(row, ['Section Level']), 1, 1, 3),
          tableRows:      parseNumber(pick(row, ['Rows', 'Table Rows']), 4, 1, 20),
          tableColumns:   tableColumns.length ? tableColumns : ['Item', 'Acceptance criteria', 'Result', 'Remarks'],
          rowBreakBefore: parseBool(row['Start New Row'] ?? row.RowBreak, true),
        },
      }
    })
    .filter(item => item.description)
}

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
  layoutJson?:         string | null
  sortOrder:           number
}

function getNextRevision(revisions: string[]) {
  const max = revisions.reduce((highest, revision) => {
    const match = revision.match(/(\d+)/)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `Rev ${max + 1}`
}

type QueryRunner = (text: string, params?: unknown[]) => Promise<unknown>

async function insertItems(
  wiId: string,
  tenantId: string,
  items: ChecklistItemInput[],
  runQuery: QueryRunner = query
) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders = chunk.map((item, j) => {
      const b = j * 20
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
        item.layoutJson || null,
        item.sortOrder,
      )
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19},$${b+20})`
    }).join(',')

    await runQuery(
      `INSERT INTO public.wi_checklist_items
         (work_instruction_id, tenant_id, item_no, description, acceptance_criteria, category,
          field_type, required, placeholder, options_json, unit, min_value, max_value,
          conditional_json, source_page, source_text, ai_confidence, ai_warnings, layout_json, sort_order)
       VALUES ${placeholders}`,
      values
    )
  }
}

export default router
