import { Router } from 'express'
import { requireAuth, requireCapability, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
import { auditLog } from '../lib/events'
import { ASSET_STATUSES, CRITICALITIES, validateAssetDates } from '../lib/assetValidation'

const router = Router()

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

// GET /api/assets
router.get('/', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const search = normalizeText(req.query.search)
    const status = normalizeText(req.query.status)
    const criticality = normalizeText(req.query.criticality)
    const page = Math.max(1, Number.parseInt(normalizeText(req.query.page) || '1', 10) || 1)
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(normalizeText(req.query.pageSize) || '50', 10) || 50),
    )
    const params: unknown[] = [req.user!.tenantId]

    let where = `WHERE a.tenant_id = $1`
    if (search) {
      params.push(`%${search}%`)
      where += ` AND (a.asset_number ILIKE $${params.length} OR a.name ILIKE $${params.length} OR a.location ILIKE $${params.length})`
    }
    if (status && status !== 'all') {
      params.push(status)
      where += ` AND a.status = $${params.length}`
    }
    if (criticality && criticality !== 'all') {
      params.push(criticality)
      where += ` AND a.criticality = $${params.length}`
    }

    const result = await query(
      `SELECT a.*,
              COUNT(DISTINCT wo.id) FILTER (WHERE wo.status IN ('open', 'in_progress'))::int AS open_work_orders,
              COUNT(DISTINCT ir.id) FILTER (WHERE ir.completed_at IS NOT NULL)::int AS completed_inspections,
              MAX(ir.completed_at) AS last_inspected_at
       FROM public.assets a
       LEFT JOIN public.work_orders wo
         ON wo.tenant_id = a.tenant_id
        AND (wo.asset_record_id = a.id
          OR (wo.asset_record_id IS NULL AND LOWER(wo.asset_name) IN (LOWER(a.asset_number), LOWER(a.name))))
       LEFT JOIN public.inspection_records ir
         ON ir.tenant_id = a.tenant_id
        AND ir.work_order_id = wo.id
       ${where}
       GROUP BY a.id
       ORDER BY
         CASE a.criticality WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         a.next_pm_date ASC NULLS LAST,
         a.name ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    )

    res.json({
      data: result.rows,
      meta: { page, pageSize, hasMore: result.rows.length === pageSize },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/assets/summary
router.get('/summary', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
         COUNT(*) FILTER (WHERE criticality IN ('high', 'critical'))::int AS high_risk,
         COUNT(*) FILTER (WHERE next_pm_date IS NOT NULL AND next_pm_date <= CURRENT_DATE + INTERVAL '30 days')::int AS pm_due_soon
       FROM public.assets
       WHERE tenant_id = $1`,
      [req.user!.tenantId],
    )
    res.json({ data: result.rows[0] })
  } catch (err) {
    next(err)
  }
})

// POST /api/assets
router.post(
  '/',
  requireAuth,
  requireCapability('asset_manager'),
  async (req: AuthRequest, res, next) => {
    try {
      const assetNumber = normalizeText(req.body.assetNumber)
      const name = normalizeText(req.body.name)
      const status = normalizeText(req.body.status) || 'active'
      const criticality = normalizeText(req.body.criticality) || 'medium'
      const installDate = normalizeText(req.body.installDate)
      const nextPmDate = normalizeText(req.body.nextPmDate)

      if (!assetNumber) {
        res.status(400).json({ error: 'Asset number is required' })
        return
      }
      if (!name) {
        res.status(400).json({ error: 'Asset name is required' })
        return
      }
      if (!ASSET_STATUSES.has(status)) {
        res.status(400).json({ error: 'Invalid asset status' })
        return
      }
      if (!CRITICALITIES.has(criticality)) {
        res.status(400).json({ error: 'Invalid asset criticality' })
        return
      }
      const dateError = validateAssetDates(installDate, nextPmDate)
      if (dateError) {
        res.status(400).json({ error: dateError })
        return
      }

      const result = await query(
        `INSERT INTO public.assets
         (tenant_id, asset_number, name, category, location, status, criticality,
          manufacturer, model, serial_number, install_date, next_pm_date, notes, created_by, department_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
        [
          req.user!.tenantId,
          assetNumber,
          name,
          normalizeText(req.body.category) || null,
          normalizeText(req.body.location) || null,
          status,
          criticality,
          normalizeText(req.body.manufacturer) || null,
          normalizeText(req.body.model) || null,
          normalizeText(req.body.serialNumber) || null,
          installDate || null,
          nextPmDate || null,
          normalizeText(req.body.notes) || null,
          req.user!.id,
          req.body.departmentId || req.user!.primaryDepartmentId,
        ],
      )

      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'asset.created',
        entityType: 'assets',
        entityId: result.rows[0].id,
        detail: { asset_number: result.rows[0].asset_number, name: result.rows[0].name },
      })

      res.status(201).json({ data: result.rows[0] })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'An asset with this number already exists in your tenant' })
        return
      }
      next(err)
    }
  },
)

// PATCH /api/assets/:id
router.patch(
  '/:id',
  requireAuth,
  requireCapability('asset_manager'),
  async (req: AuthRequest, res, next) => {
    try {
      const status = req.body.status != null ? normalizeText(req.body.status) : null
      const criticality = req.body.criticality != null ? normalizeText(req.body.criticality) : null
      if (status && !ASSET_STATUSES.has(status)) {
        res.status(400).json({ error: 'Invalid asset status' })
        return
      }
      if (criticality && !CRITICALITIES.has(criticality)) {
        res.status(400).json({ error: 'Invalid asset criticality' })
        return
      }
      const installDate = req.body.installDate != null ? normalizeText(req.body.installDate) : ''
      const nextPmDate = req.body.nextPmDate != null ? normalizeText(req.body.nextPmDate) : ''
      const dateError = validateAssetDates(installDate, nextPmDate)
      if (dateError) {
        res.status(400).json({ error: dateError })
        return
      }

      const result = await query(
        `UPDATE public.assets
       SET name = COALESCE($1, name),
           category = COALESCE($2, category),
           location = COALESCE($3, location),
           status = COALESCE($4, status),
           criticality = COALESCE($5, criticality),
           manufacturer = COALESCE($6, manufacturer),
           model = COALESCE($7, model),
           serial_number = COALESCE($8, serial_number),
           install_date = COALESCE($9, install_date),
           next_pm_date = COALESCE($10, next_pm_date),
           notes = COALESCE($11, notes),
           updated_at = NOW()
       WHERE id = $12
         AND tenant_id = $13
       RETURNING *`,
        [
          req.body.name != null ? normalizeText(req.body.name) : null,
          req.body.category != null ? normalizeText(req.body.category) : null,
          req.body.location != null ? normalizeText(req.body.location) : null,
          status,
          criticality,
          req.body.manufacturer != null ? normalizeText(req.body.manufacturer) : null,
          req.body.model != null ? normalizeText(req.body.model) : null,
          req.body.serialNumber != null ? normalizeText(req.body.serialNumber) : null,
          req.body.installDate != null ? installDate || null : null,
          req.body.nextPmDate != null ? nextPmDate || null : null,
          req.body.notes != null ? normalizeText(req.body.notes) : null,
          req.params.id,
          req.user!.tenantId,
        ],
      )

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Asset not found' })
        return
      }

      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'asset.updated',
        entityType: 'assets',
        entityId: result.rows[0].id,
        detail: { asset_number: result.rows[0].asset_number, status: result.rows[0].status },
      })

      res.json({ data: result.rows[0] })
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        res.status(409).json({ error: 'An asset with this number already exists in your tenant' })
        return
      }
      next(err)
    }
  },
)

export default router
