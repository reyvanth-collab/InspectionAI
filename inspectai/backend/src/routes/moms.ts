import { Router } from 'express'
import multer from 'multer'
import * as XLSX from 'xlsx'
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
import { auditLog } from '../lib/events'

const router  = Router()
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// ── DDL: ensure table exists with correct schema ───────────────
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.moms_checklist_steps (
    id               BIGSERIAL PRIMARY KEY,
    tenant_id        UUID NOT NULL,
    moms_id          BIGINT,
    work_order_id    TEXT,
    template_id      TEXT,
    template_name    TEXT,
    wi_number        TEXT,
    wr_number        TEXT,
    wi_title         TEXT,
    station          TEXT,
    equipment_id     TEXT,
    section_name     TEXT,
    sub_section_no   TEXT,
    sub_section_name TEXT,
    sub_item_no      TEXT,
    sub_item_name    TEXT,
    step_no          TEXT,
    step_desc        TEXT,
    col_header       TEXT,
    ctrl_type        TEXT,
    category         TEXT,
    result           TEXT,
    remark           TEXT,
    is_filled        BOOLEAN DEFAULT FALSE,
    has_nok          BOOLEAN DEFAULT FALSE,
    filled_by        TEXT,
    inspected_at     TIMESTAMPTZ,
    imported_at      TIMESTAMPTZ DEFAULT NOW()
  )
`

// ── Parse Excel row → DB row ───────────────────────────────────
// Handles both extract.py v4 columns and older column names gracefully.
interface StepRow {
  moms_id:          number
  work_order_id:    string
  template_id:      string
  template_name:    string
  wi_number:        string
  wr_number:        string | null
  wi_title:         string | null
  station:          string | null
  equipment_id:     string | null
  section_name:     string | null
  sub_section_no:   string | null
  sub_section_name: string | null
  sub_item_no:      string | null
  sub_item_name:    string | null
  step_no:          string | null
  step_desc:        string | null
  col_header:       string | null
  ctrl_type:        string | null
  category:         string | null
  result:           string | null
  remark:           string | null
  is_filled:        boolean
  has_nok:          boolean
  filled_by:        string | null
  inspected_at:     Date | null
}

function str(v: unknown): string | null {
  if (v == null || String(v).trim() === '' || String(v) === 'None') return null
  return String(v).trim()
}

function parseRows(sheet: XLSX.WorkSheet): StepRow[] {
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  })

  return raw.map(r => {
    // extract.py v4 uses FieldLabel; older may use StepDesc
    const stepDesc = str(r['FieldLabel']) ?? str(r['StepDesc'])

    // extract.py v4 uses Value; older may use Result
    const result = str(r['Value']) ?? str(r['Result'])

    // IsNOK is dropped from Excel output — derive from result
    const hasNok = result === 'NOK'

    // is_filled: v4 drops IsFilled — derive from non-empty result
    const isFilled = result != null && result.trim() !== ''

    const inspectedAt: Date | null =
      r['Created'] instanceof Date ? r['Created']
      : r['Created'] != null       ? new Date(String(r['Created']))
      : null

    return {
      moms_id:          Number(r['ID'])             || 0,
      work_order_id:    str(r['WorkOrderID'])        ?? '',
      template_id:      str(r['TemplateID'])         ?? '',
      template_name:    str(r['Template'])           ?? '',
      wi_number:        str(r['WI_Number'])          ?? '',
      wr_number:        str(r['WR_Number']),
      wi_title:         str(r['WI_Title']),
      station:          str(r['Station']),
      equipment_id:     str(r['EquipmentID']),
      section_name:     str(r['SectionName']),
      sub_section_no:   str(r['SubSectionNo']),
      sub_section_name: str(r['SubSectionName']),
      sub_item_no:      str(r['SubItemNo']),
      sub_item_name:    str(r['SubItemName']),
      step_no:          str(r['StepNo']),
      step_desc:        stepDesc,
      col_header:       str(r['ColHeader']),
      ctrl_type:        str(r['CtrlType']),
      category:         str(r['Category']),
      result,
      remark:           str(r['Remark']),
      is_filled:        isFilled,
      has_nok:          hasNok,
      filled_by:        str(r['FilledBy']),
      inspected_at:     inspectedAt,
    }
  })
}

// ── POST /api/moms/import ─────────────────────────────────────
router.post(
  '/import',
  requireAuth,
  requireRole('admin', 'approver'),
  upload.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return }

      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })

      // Accept All_Years, Checklist_Steps, or any year sheet
      const sheetName =
        wb.SheetNames.find(n => n === 'All_Years') ??
        wb.SheetNames.find(n => n === 'Checklist_Steps') ??
        wb.SheetNames.find(n => /^\d{4}$/.test(n))

      if (!sheetName) {
        res.status(422).json({
          error: `No recognised sheet found. Expected 'All_Years' or 'Checklist_Steps'. Found: ${wb.SheetNames.join(', ')}`,
        }); return
      }

      const rows = parseRows(wb.Sheets[sheetName])
      if (rows.length === 0) {
        res.status(422).json({ error: `No rows found in sheet '${sheetName}'` }); return
      }

      // Ensure table + indexes; backfill columns added after initial deploy
      await query(CREATE_TABLE_SQL)
      await query(`ALTER TABLE IF EXISTS public.moms_checklist_steps ADD COLUMN IF NOT EXISTS section_name     TEXT`)
      await query(`ALTER TABLE IF EXISTS public.moms_checklist_steps ADD COLUMN IF NOT EXISTS sub_section_name TEXT`)
      await query(`ALTER TABLE IF EXISTS public.moms_checklist_steps ADD COLUMN IF NOT EXISTS category         TEXT`)
      await query(`CREATE INDEX IF NOT EXISTS idx_moms_tenant_wi    ON public.moms_checklist_steps (tenant_id, wi_number)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_moms_work_order   ON public.moms_checklist_steps (tenant_id, work_order_id)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_moms_inspected_at ON public.moms_checklist_steps (tenant_id, inspected_at)`)
      await query(`CREATE INDEX IF NOT EXISTS idx_moms_category     ON public.moms_checklist_steps (tenant_id, category)`)

      const tenantId = req.user!.tenantId
      const CHUNK    = 500
      let   inserted = 0

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        const values: unknown[] = []

        const placeholders = chunk.map((r, j) => {
          const b = j * 26
          values.push(
            tenantId, r.moms_id, r.work_order_id, r.template_id, r.template_name,
            r.wi_number, r.wr_number, r.wi_title, r.station, r.equipment_id,
            r.section_name, r.sub_section_no, r.sub_section_name, r.sub_item_no, r.sub_item_name,
            r.step_no, r.step_desc, r.col_header, r.ctrl_type, r.category,
            r.result, r.remark, r.is_filled, r.has_nok, r.filled_by, r.inspected_at,
          )
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16},$${b+17},$${b+18},$${b+19},$${b+20},$${b+21},$${b+22},$${b+23},$${b+24},$${b+25},$${b+26},NOW())`
        }).join(',')

        await query(
          `INSERT INTO public.moms_checklist_steps
             (tenant_id,moms_id,work_order_id,template_id,template_name,wi_number,wr_number,wi_title,
              station,equipment_id,section_name,sub_section_no,sub_section_name,sub_item_no,sub_item_name,
              step_no,step_desc,col_header,ctrl_type,category,result,remark,is_filled,has_nok,
              filled_by,inspected_at,imported_at)
           VALUES ${placeholders}`,
          values
        )
        inserted += chunk.length
      }

      // Build response summary
      const wiNumbers  = [...new Set(rows.map(r => r.wi_number).filter(Boolean))]
      const woIds      = [...new Set(rows.map(r => r.work_order_id).filter(Boolean))]
      const nokCount   = rows.filter(r => r.has_nok).length
      const filled     = rows.filter(r => r.is_filled).length

      res.json({
        message: 'Import successful',
        data: {
          inserted, sheet: sheetName,
          wiNumbers, workOrders: woIds,
          filledRows: filled, nokCount,
        },
      })
      await auditLog({
        tenantId: req.user!.tenantId,
        userId: req.user!.id,
        action: 'moms.imported',
        entityType: 'moms_checklist_steps',
        detail: { inserted, sheet: sheetName, wi_numbers: wiNumbers, work_orders: woIds.length, nok_count: nokCount },
      })
    } catch (err) { next(err) }
  }
)

// ── Shared filter builder ──────────────────────────────────────
// Returns { whereClause, params } for filtering by tenant + WI + dates.
// Only counts Radio (result category) steps for NOK analytics.
function buildFilter(
  tenantId: string,
  wiNumber: string,
  fromDate?: string,
  toDate?: string,
  onlyResults = true, // if true, filter to category='result' (Radio OK/NOK/NA only)
): { where: string; params: unknown[] } {
  const params: unknown[] = [tenantId, `%${wiNumber}%`]
  let where = `WHERE tenant_id = $1 AND wi_number ILIKE $2`

  if (onlyResults) {
    where += ` AND category = 'result'`
  }

  if (fromDate) {
    params.push(fromDate)
    where += ` AND inspected_at >= $${params.length}::date`
  }
  if (toDate) {
    params.push(toDate)
    where += ` AND inspected_at < ($${params.length}::date + INTERVAL '1 day')`
  }

  return { where, params }
}

// ── GET /api/moms/analytics/:wiNumber ─────────────────────────
router.get('/analytics/:wiNumber', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const wiNumber = decodeURIComponent(req.params.wiNumber)
    const tenantId = req.user!.tenantId
    const { from_date, to_date } = req.query as Record<string, string>

    const { where, params } = buildFilter(tenantId, wiNumber, from_date, to_date)

    const [overviewRes, byStepRes, byStationRes, trendRes] = await Promise.all([
      query(
        `SELECT
           COUNT(*)                                        AS total,
           COUNT(*) FILTER (WHERE result = 'OK')          AS ok_count,
           COUNT(*) FILTER (WHERE result = 'NOK')         AS nok_count,
           COUNT(*) FILTER (WHERE result = 'NA')          AS na_count,
           COUNT(DISTINCT work_order_id)                  AS work_orders,
           COUNT(DISTINCT station)                        AS stations,
           MIN(inspected_at)                              AS earliest,
           MAX(inspected_at)                              AS latest
         FROM public.moms_checklist_steps
         ${where}`,
        params
      ),
      query(
        `SELECT
           COALESCE(sub_section_name, section_name, 'General') AS section,
           step_no,
           LEFT(step_desc, 120)                                 AS step_desc,
           COUNT(*)                                             AS total,
           COUNT(*) FILTER (WHERE result = 'NOK')              AS nok_count,
           ROUND(100.0 * COUNT(*) FILTER (WHERE result='NOK') / NULLIF(COUNT(*),0), 1) AS nok_rate
         FROM public.moms_checklist_steps
         ${where}
         GROUP BY COALESCE(sub_section_name,section_name,'General'), step_no, LEFT(step_desc,120)
         ORDER BY nok_count DESC
         LIMIT 50`,
        params
      ),
      query(
        `SELECT
           COALESCE(station, 'Unknown')                         AS station,
           COUNT(*)                                             AS total,
           COUNT(*) FILTER (WHERE result = 'NOK')              AS nok_count,
           ROUND(100.0 * COUNT(*) FILTER (WHERE result='NOK') / NULLIF(COUNT(*),0), 1) AS nok_rate
         FROM public.moms_checklist_steps
         ${where}
         GROUP BY COALESCE(station,'Unknown')
         ORDER BY nok_count DESC`,
        params
      ),
      query(
        `SELECT
           DATE_TRUNC('month', inspected_at)                   AS month,
           COUNT(DISTINCT work_order_id)                       AS work_orders,
           COUNT(*) FILTER (WHERE result = 'NOK')              AS nok_count,
           COUNT(*)                                            AS total
         FROM public.moms_checklist_steps
         ${where} AND inspected_at IS NOT NULL
         GROUP BY DATE_TRUNC('month', inspected_at)
         ORDER BY month ASC`,
        params
      ),
    ])

    res.json({
      data: {
        overview:  overviewRes.rows[0],
        byStep:    byStepRes.rows,
        byStation: byStationRes.rows,
        trend:     trendRes.rows,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /api/moms/wi-summary/:wiNumber ────────────────────────
router.get('/wi-summary/:wiNumber', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const wiNumber = decodeURIComponent(req.params.wiNumber)
    const tenantId = req.user!.tenantId
    const { where, params } = buildFilter(tenantId, wiNumber)

    const [overviewRes, topNokRes] = await Promise.all([
      query(
        `SELECT
           COUNT(*)                                        AS total,
           COUNT(*) FILTER (WHERE result = 'NOK')         AS nok_count,
           COUNT(DISTINCT work_order_id)                  AS work_orders
         FROM public.moms_checklist_steps
         ${where}`,
        params
      ),
      query(
        `SELECT
           COALESCE(sub_section_name, section_name, 'General') AS section,
           step_no, LEFT(step_desc, 200) AS step_desc,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE result = 'NOK') AS nok_count,
           ROUND(100.0 * COUNT(*) FILTER (WHERE result='NOK') / NULLIF(COUNT(*),0), 1) AS nok_rate
         FROM public.moms_checklist_steps
         ${where}
         GROUP BY COALESCE(sub_section_name,section_name,'General'), step_no, LEFT(step_desc,200)
         HAVING COUNT(*) FILTER (WHERE result='NOK') > 0
         ORDER BY nok_count DESC LIMIT 10`,
        params
      ),
    ])

    const ov       = overviewRes.rows[0]
    const total    = parseInt(ov.total)    || 0
    const nokCount = parseInt(ov.nok_count) || 0
    const nokRate  = total > 0 ? parseFloat(((nokCount / total) * 100).toFixed(1)) : 0

    res.json({
      data: {
        nokRate,
        totalInspections: parseInt(ov.work_orders) || 0,
        totalSteps:       total,
        nokCount,
        topNokSteps:      topNokRes.rows,
      },
    })
  } catch (err) { next(err) }
})

// ── GET /api/moms/wi-numbers ───────────────────────────────────
router.get('/wi-numbers', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT wi_number, wi_title, COUNT(DISTINCT work_order_id) AS work_orders,
              MIN(inspected_at) AS earliest, MAX(inspected_at) AS latest
       FROM public.moms_checklist_steps
       WHERE tenant_id = $1 AND wi_number IS NOT NULL AND wi_number != ''
       GROUP BY wi_number, wi_title
       ORDER BY wi_number`,
      [req.user!.tenantId]
    )
    res.json({ data: result.rows })
  } catch (err) { next(err) }
})

export default router
