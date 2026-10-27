import { Router } from 'express'
import { listOrder } from '../lib/listOrder'
import { randomUUID } from 'node:crypto'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { pool, query, beginActorTransaction } from '../lib/db'
import { auditLog, notifyUsers } from '../lib/events'

const router = Router()
const WI_STATUSES = new Set([
  'draft',
  'pending_approval',
  'active',
  'expiring',
  'expired',
  'superseded',
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── Auto-migrate: add field-builder columns to wi_checklist_items ──
// ── GET /api/work-instructions ───────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { search } = req.query
    const page = Math.max(1, Math.min(10000, Number.parseInt(String(req.query.page ?? 1), 10) || 1))
    let sql = `
      SELECT wi.id, wi.wi_number, wi.title, wi.category, wi.revision,
             wi.status, wi.effective_date, wi.expiry_date, wi.department_id, wi.owner_id, wi.previous_revision_id,
             u.name AS owner_name,
             COUNT(ci.id)::int AS checklist_item_count,
             COUNT(ci.id) FILTER (
               WHERE COALESCE(ci.field_type, 'pass_fail') <> 'heading'
             )::int AS checkable_item_count
      FROM   public.work_instructions wi
      LEFT JOIN public.departments d ON d.id=wi.department_id
      LEFT JOIN public.users u ON u.id = wi.owner_id
      LEFT JOIN public.wi_checklist_items ci
        ON ci.work_instruction_id = wi.id
       AND ci.tenant_id = wi.tenant_id
      WHERE  wi.tenant_id = $1`
    const params: unknown[] = [req.user!.tenantId]

    for (const [key, column] of [
      ['status', 'wi.status'],
      ['departmentId', 'wi.department_id'],
    ] as const) {
      if (req.query[key]) {
        if (key === 'status' && req.query[key] === 'active') {
          sql += " AND wi.status IN ('active','expiring')"
          continue
        }
        params.push(String(req.query[key]))
        sql += ` AND ${column} = $${params.length}`
      }
    }
    if (req.query.mine === 'true') {
      params.push(req.user!.id)
      sql += ` AND wi.owner_id = $${params.length}`
    }
    if (req.query.needsApproval === 'true') {
      params.push(req.user!.id)
      sql += ` AND EXISTS(SELECT 1 FROM public.approval_records ar JOIN public.approval_steps s ON s.approval_record_id=ar.id WHERE ar.work_instruction_id=wi.id AND s.approver_id=$${params.length} AND s.status='active')`
    }

    if (search) {
      params.push(`%${search}%`)
      sql += ` AND (wi.title ILIKE $${params.length} OR wi.wi_number ILIKE $${params.length})`
    }
    const totalSql = `SELECT count(*)::int total FROM (${sql} GROUP BY wi.id,u.name,d.name) matching`
    const total = (await query(totalSql, params)).rows[0].total
    const pageSize = Math.max(
      1,
      Math.min(200, Number.parseInt(String(req.query.pageSize || 50)) || 50),
    )
    const order = listOrder(
      req.query,
      {
        reference: 'wi.wi_number',
        title: 'wi.title',
        department: 'd.name',
        revision: 'wi.revision',
        questions: 'checkable_item_count',
        status: 'wi.status',
        author: 'u.name',
      },
      'reference',
      'wi.id',
    )
    sql += `
      GROUP BY wi.id, wi.wi_number, wi.title, wi.category, wi.revision,
               wi.status, wi.effective_date, wi.expiry_date, u.name,d.name
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET $${params.length + 1}`

    const result = await query(sql, [...params, (page - 1) * pageSize])
    res.json({
      data: result.rows,
      meta: { page, pageSize, total, hasMore: page * pageSize < total },
    })
  } catch (err) {
    next(err)
  }
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
        [req.params.id, req.user!.tenantId],
      ),
      query(
        `SELECT id, item_no, description, acceptance_criteria, category, sort_order,
                field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json,
                source_page, source_text, ai_confidence, ai_warnings, layout_json, lineage_id
         FROM public.wi_checklist_items
         WHERE work_instruction_id = $1
           AND tenant_id = $2
         ORDER BY sort_order`,
        [req.params.id, req.user!.tenantId],
      ),
      query(
        `SELECT *
         FROM public.wi_revision_history
         WHERE work_instruction_id = $1
           AND tenant_id = $2
         ORDER BY effective_date DESC`,
        [req.params.id, req.user!.tenantId],
      ),
    ])

    if (wiRes.rows.length === 0) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({
      data: {
        ...wiRes.rows[0],
        wi_checklist_items: itemsRes.rows,
        wi_revision_history: historyRes.rows,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/work-instructions/:id/items ────────────────────────
router.get('/:id/items', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT id, item_no, description, acceptance_criteria, category, sort_order,
              field_type, required, placeholder, options_json, unit, min_value, max_value, conditional_json,
              source_page, source_text, ai_confidence, ai_warnings, layout_json, lineage_id
       FROM public.wi_checklist_items
       WHERE work_instruction_id = $1
         AND tenant_id = $2
       ORDER BY sort_order`,
      [req.params.id, req.user!.tenantId],
    )
    res.json({ data: result.rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/work-instructions ─────────────────────────────────
// Creates a new WI and optionally inserts checklist items in the same request.
router.post(
  '/',
  requireAuth,
  requireCapability('form_author'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      await beginActorTransaction(client)
      const validation = validateItems(req.body)
      if (validation) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: validation })
        return
      }
      const {
        wiNumber,
        title,
        description,
        category,
        revision,
        effectiveDate,
        expiryDate,
        status,
        checklistItems,
      } = req.body as {
        wiNumber: string
        title: string
        description?: string
        category?: string
        revision: string
        effectiveDate?: string
        expiryDate?: string
        status?: string
        checklistItems?: ChecklistItemInput[]
      }
      const normalizedStatus = 'draft'
      if (status && status !== 'draft') {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only the approval workflow can activate an instruction' })
        return
      }
      if (!WI_STATUSES.has(normalizedStatus)) {
        res.status(400).json({ error: 'Invalid work instruction status' })
        return
      }

      const wiResult = await client.query(
        `INSERT INTO public.work_instructions
         (wi_number, title, description, category, revision, status, effective_date, expiry_date, owner_id, tenant_id, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
        [
          wiNumber,
          title,
          description || null,
          category || null,
          revision,
          normalizedStatus,
          effectiveDate || null,
          expiryDate || null,
          req.user!.id,
          req.user!.tenantId,
          req.body.departmentId || req.user!.primaryDepartmentId,
        ],
      )
      const wi = wiResult.rows[0]

      if (checklistItems?.length) {
        await insertItems(wi.id, req.user!.tenantId, checklistItems, client.query.bind(client))
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
  },
)

// ── PUT /api/work-instructions/:id ──────────────────────────────
// Full replacement: update metadata + delete-all + re-insert items.
router.put(
  '/:id',
  requireAuth,
  requireCapability('form_author'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      await beginActorTransaction(client)
      const validation = validateItems(req.body)
      if (validation) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: validation })
        return
      }
      await client.query("SELECT set_config('app.change_reason',$1,true)", [
        String(req.body.changeSummary || 'Draft edited'),
      ])
      const locked = await client.query(
        'SELECT status FROM public.work_instructions WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [req.params.id, req.user!.tenantId],
      )
      if (!locked.rows.length) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Not found' })
        return
      }
      if (locked.rows[0].status !== 'draft') {
        await client.query('ROLLBACK')
        res.status(409).json({
          error: 'Approved or submitted instructions are immutable. Create a new draft revision.',
        })
        return
      }
      const {
        wiNumber,
        title,
        description,
        category,
        revision,
        effectiveDate,
        expiryDate,
        status,
        checklistItems,
      } = req.body as {
        wiNumber: string
        title: string
        description?: string
        category?: string
        revision: string
        effectiveDate?: string
        expiryDate?: string
        status?: string
        checklistItems?: ChecklistItemInput[]
      }
      const normalizedStatus = 'draft'
      if (status && status !== 'draft') {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only the approval workflow can activate an instruction' })
        return
      }
      if (!WI_STATUSES.has(normalizedStatus)) {
        res.status(400).json({ error: 'Invalid work instruction status' })
        return
      }

      const wiResult = await client.query(
        `UPDATE public.work_instructions
       SET    wi_number=$1, title=$2, description=$3, category=$4, revision=$5,
              status=$6, effective_date=$7, expiry_date=$8, updated_at=NOW()
       WHERE  id=$9 AND tenant_id=$10
       RETURNING *`,
        [
          wiNumber,
          title,
          description || null,
          category || null,
          revision,
          normalizedStatus,
          effectiveDate || null,
          expiryDate || null,
          req.params.id,
          req.user!.tenantId,
        ],
      )
      if (wiResult.rows.length === 0) {
        res.status(404).json({ error: 'Not found' })
        return
      }

      // Keep stable question IDs and revision lineage. Only omitted items are deleted.
      const existingItems = await client.query(
        'SELECT id FROM public.wi_checklist_items WHERE work_instruction_id=$1 AND tenant_id=$2',
        [req.params.id, req.user!.tenantId],
      )
      const existingIds = new Set(existingItems.rows.map((row) => row.id))
      const keepIds = (checklistItems || [])
        .filter((item) => item.id && existingIds.has(item.id))
        .map((item) => item.id)
      await client.query(
        `DELETE FROM public.wi_checklist_items WHERE work_instruction_id = $1 AND tenant_id = $2 AND NOT(id=ANY($3::uuid[]))`,
        [req.params.id, req.user!.tenantId, keepIds],
      )
      if (checklistItems?.length) {
        for (const item of checklistItems) {
          if (item.id && existingIds.has(item.id)) {
            await client.query(
              `UPDATE public.wi_checklist_items SET item_no=$1,description=$2,acceptance_criteria=$3,category=$4,field_type=$5,required=$6,placeholder=$7,options_json=$8,unit=$9,min_value=$10,max_value=$11,conditional_json=$12,layout_json=$13,sort_order=$14 WHERE id=$15 AND work_instruction_id=$16 AND tenant_id=$17`,
              [
                item.itemNo,
                item.description,
                item.acceptanceCriteria || null,
                item.category || null,
                item.fieldType || 'pass_fail',
                item.required ?? true,
                item.placeholder || null,
                item.optionsJson || null,
                item.unit || null,
                item.minValue ?? null,
                item.maxValue ?? null,
                item.conditionalJson || null,
                item.layoutJson || null,
                item.sortOrder,
                item.id,
                req.params.id,
                req.user!.tenantId,
              ],
            )
          } else {
            await insertItems(req.params.id, req.user!.tenantId, [item], client.query.bind(client))
          }
        }
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
      await client.query('ROLLBACK')
      next(err)
    } finally {
      client.release()
    }
  },
)

// ── PATCH /api/work-instructions/:id ────────────────────────────
router.patch('/:id', requireAuth, (_req, res) => {
  res.status(405).json({ error: 'Use the draft editor; approved revisions are immutable' })
})
router.patch('/:id/status', requireAuth, (_req, res) => {
  res.status(405).json({ error: 'Use the approval workflow' })
})

// ── POST /api/work-instructions/:id/submit-approval ─────────────
router.post(
  '/:id/submit-approval',
  requireAuth,
  requireCapability('form_author'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      const { approverIds } = req.body as { approverIds: string[] }
      const wiId = req.params.id
      const submittedApproverIds = Array.isArray(approverIds) ? approverIds : []
      const uniqueApproverIds = [...new Set(submittedApproverIds.filter(Boolean))]
      if (uniqueApproverIds.length === 0) {
        res.status(400).json({ error: 'At least one approver is required' })
        return
      }
      if (uniqueApproverIds.some((id) => !UUID_RE.test(id))) {
        res.status(400).json({ error: 'Approver IDs must be valid UUIDs' })
        return
      }

      const approverRes = await query(
        `SELECT id
       FROM public.users
       WHERE tenant_id = $1
         AND active = true
         AND ('form_approver'=ANY(capabilities) OR 'administrator'=ANY(capabilities))
         AND id = ANY($2::uuid[])`,
        [req.user!.tenantId, uniqueApproverIds],
      )
      const validApproverIds = new Set(approverRes.rows.map((row) => row.id))
      if (uniqueApproverIds.some((id) => !validApproverIds.has(id))) {
        res
          .status(400)
          .json({ error: 'Approvers must be active admin or approver users in your tenant' })
        return
      }

      await beginActorTransaction(client)

      const wiRes = await client.query(
        `SELECT id, wi_number, title, revision, status, owner_id, department_id
       FROM public.work_instructions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
        [wiId, req.user!.tenantId],
      )
      if (wiRes.rows.length === 0) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Work instruction not found' })
        return
      }

      if (wiRes.rows[0].status !== 'draft') {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only a draft can be submitted' })
        return
      }
      const form = wiRes.rows[0]
      const contributors = await client.query(
        'SELECT id FROM public.users WHERE id=ANY($1::uuid[]) AND inspectai_private.form_contributor($2::uuid,id)',
        [uniqueApproverIds, wiId],
      )
      if (contributors.rows.length) {
        await client.query('ROLLBACK')
        res
          .status(400)
          .json({ error: 'Choose independent reviewers who have not edited this revision' })
        return
      }
      if (uniqueApproverIds.includes(form.owner_id)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'The form author cannot approve their own revision' })
        return
      }
      const membership = await client.query(
        `SELECT u.id FROM public.users u WHERE u.id=ANY($1::uuid[]) AND u.tenant_id=$2 AND (u.primary_department_id=$3 OR EXISTS(SELECT 1 FROM public.department_memberships m WHERE m.user_id=u.id AND m.department_id=$3 AND m.tenant_id=$2))`,
        [uniqueApproverIds, req.user!.tenantId, form.department_id],
      )
      if (membership.rows.length !== uniqueApproverIds.length) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Reviewers need explicit membership of the form department' })
        return
      }
      const questions = await client.query(
        "SELECT id FROM public.wi_checklist_items WHERE work_instruction_id=$1 AND field_type<>'heading'",
        [wiId],
      )
      if (!questions.rows.length) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Add at least one question before submitting' })
        return
      }
      if (uniqueApproverIds.includes(req.user!.id)) {
        await client.query('ROLLBACK')
        res.status(400).json({ error: 'Submitter cannot approve their own instruction' })
        return
      }
      const activeRes = await client.query(
        `SELECT id
       FROM public.approval_records
       WHERE work_instruction_id = $1
         AND tenant_id = $2
         AND final_status = 'active'
       LIMIT 1`,
        [wiId, req.user!.tenantId],
      )
      if (activeRes.rows.length > 0) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'This work instruction is already awaiting approval' })
        return
      }

      const approvalRes = await client.query(
        `INSERT INTO public.approval_records
         (work_instruction_id, tenant_id, submitted_by, current_step, final_status)
       VALUES ($1, $2, $3, 1, 'active')
       RETURNING id`,
        [wiId, req.user!.tenantId, req.user!.id],
      )
      const approvalRecordId = approvalRes.rows[0].id as string

      for (let i = 0; i < uniqueApproverIds.length; i++) {
        const label =
          i === 0
            ? 'Technical Check'
            : i === uniqueApproverIds.length - 1
              ? 'Final Approval'
              : `Review ${i + 1}`
        await client.query(
          `INSERT INTO public.approval_steps
           (approval_record_id, tenant_id, step_number, label, approver_id, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            approvalRecordId,
            req.user!.tenantId,
            i + 1,
            label,
            uniqueApproverIds[i],
            i === 0 ? 'active' : 'wait',
          ],
        )
      }

      await client.query(
        `UPDATE public.work_instructions
       SET status = 'pending_approval', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
        [wiId, req.user!.tenantId],
      )

      await client.query('COMMIT')

      const wi = wiRes.rows[0]
      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'wi.submitted_for_approval',
        entityType: 'approval_records',
        entityId: approvalRecordId,
        detail: {
          wi_number: wi.wi_number,
          revision: wi.revision,
          approver_count: uniqueApproverIds.length,
        },
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
  },
)

router.post(
  '/:id/revise',
  requireAuth,
  requireCapability('form_author'),
  async (req: AuthRequest, res, next) => {
    const client = await pool.connect()
    try {
      await beginActorTransaction(client)
      const source = await client.query(
        'SELECT * FROM public.work_instructions WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [req.params.id, req.user!.tenantId],
      )
      if (!source.rows.length) {
        await client.query('ROLLBACK')
        res.status(404).json({ error: 'Not found' })
        return
      }
      const old = source.rows[0]
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        req.user!.tenantId + ':form:' + old.wi_number,
      ])
      const family = await client.query(
        'SELECT revision FROM public.work_instructions WHERE tenant_id=$1 AND wi_number=$2',
        [req.user!.tenantId, old.wi_number],
      )
      const revisions = new Set(family.rows.map((row) => row.revision))
      let nextRevision = family.rows.length + 1
      while (revisions.has(`Rev ${nextRevision}`)) nextRevision++
      if (!['active', 'expiring', 'expired', 'superseded'].includes(old.status)) {
        await client.query('ROLLBACK')
        res.status(409).json({ error: 'Only a published or previous version can be revised' })
        return
      }
      await client.query("SELECT set_config('app.change_reason',$1,true)", [
        String(req.body.changeSummary || 'New draft revision'),
      ])
      const created = await client.query(
        `INSERT INTO public.work_instructions(tenant_id,wi_number,title,description,category,revision,status,owner_id,department_id,previous_revision_id)
   VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING *`,
        [
          req.user!.tenantId,
          old.wi_number,
          old.title,
          old.description,
          old.category,
          `Rev ${nextRevision}`,
          req.user!.id,
          old.department_id,
          old.id,
        ],
      )
      await client.query(
        `INSERT INTO public.wi_checklist_items(tenant_id,work_instruction_id,item_no,description,acceptance_criteria,category,sort_order,field_type,required,placeholder,options_json,unit,min_value,max_value,conditional_json,source_page,source_text,ai_confidence,ai_warnings,layout_json,lineage_id)
   SELECT tenant_id,$1,item_no,description,acceptance_criteria,category,sort_order,field_type,required,placeholder,options_json,unit,min_value,max_value,conditional_json,source_page,source_text,ai_confidence,ai_warnings,layout_json,lineage_id FROM public.wi_checklist_items WHERE work_instruction_id=$2 AND tenant_id=$3`,
        [created.rows[0].id, old.id, req.user!.tenantId],
      )
      await client.query('COMMIT')
      res.status(201).json({ data: created.rows[0] })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      next(err)
    } finally {
      client.release()
    }
  },
)

// ── Helpers ──────────────────────────────────────────────────────
interface ChecklistItemInput {
  id?: string
  layoutJson?: string
  itemNo: string
  description: string
  acceptanceCriteria?: string
  category?: string
  fieldType?: string
  required?: boolean
  placeholder?: string
  optionsJson?: string
  unit?: string
  minValue?: number | null
  maxValue?: number | null
  conditionalJson?: string
  sourcePage?: number | null
  sourceText?: string | null
  aiConfidence?: number | null
  aiWarnings?: string[] | null
  sortOrder: number
}

async function insertItems(
  wiId: string,
  tenantId: string,
  items: ChecklistItemInput[],
  run: typeof query = query,
) {
  const CHUNK = 100
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders = chunk
      .map((item, j) => {
        const b = j * 21
        values.push(
          wiId,
          tenantId,
          item.itemNo,
          item.description,
          item.acceptanceCriteria || null,
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
          item.layoutJson || null,
          item.id || randomUUID(),
        )
        return '(' + Array.from({ length: 21 }, (_, n) => `$${b + n + 1}`).join(',') + ')'
      })
      .join(',')

    await run(
      `INSERT INTO public.wi_checklist_items
         (work_instruction_id, tenant_id, item_no, description, acceptance_criteria, category,
          field_type, required, placeholder, options_json, unit, min_value, max_value,
          conditional_json, source_page, source_text, ai_confidence, ai_warnings, sort_order, layout_json, id)
       VALUES ${placeholders}`,
      values,
    )
  }
}

export default router

function validateItems(body: any): string | null {
  for (const key of ['wiNumber', 'title', 'revision'])
    if (typeof body[key] !== 'string' || !body[key].trim())
      return 'Form reference, title and revision are required'
  if (
    body.checklistItems !== undefined &&
    (!Array.isArray(body.checklistItems) || body.checklistItems.length > 300)
  )
    return 'Supply up to 300 questions'
  const ids = new Set<string>()
  for (const item of body.checklistItems || []) {
    if (!item || typeof item !== 'object' || typeof item.description !== 'string')
      return 'Every question needs a label'
    if (!Number.isInteger(item.sortOrder)) return 'Every question needs an integer sort order'
    if (item.required !== undefined && typeof item.required !== 'boolean')
      return 'Required must be a boolean'
    for (const key of ['minValue', 'maxValue'])
      if (item[key] != null && !Number.isFinite(Number(item[key])))
        return 'Measurement limits must be finite numbers'
    if (!item.description?.trim() || !item.itemNo) return 'Every question needs a label and number'
    if (item.id && (!UUID_RE.test(item.id) || ids.has(item.id)))
      return 'Question IDs must be unique UUIDs'
    if (item.id) ids.add(item.id)
    if (
      ![
        'pass_fail',
        'yes_no',
        'text',
        'textarea',
        'number',
        'measurement',
        'select',
        'dropdown',
        'multiselect',
        'date',
        'checkbox',
        'heading',
        'table',
        'photo',
        'signature',
      ].includes(item.fieldType || 'pass_fail')
    )
      return 'Unsupported response type'
    for (const key of ['layoutJson', 'optionsJson', 'conditionalJson'])
      if (item[key]) {
        try {
          JSON.parse(item[key])
        } catch {
          return `Invalid question ${key}`
        }
      }
    if (
      item.minValue != null &&
      item.maxValue != null &&
      Number(item.minValue) > Number(item.maxValue)
    )
      return 'Minimum cannot exceed maximum'
  }
  return null
}
