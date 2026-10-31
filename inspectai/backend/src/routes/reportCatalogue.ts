import { Router } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { query } from '../lib/db'
import {
  buildReport,
  reportCatalogue,
  columns,
  safeCsv,
  type Observation,
} from '../lib/reportEngine'
const router = Router()
router.use(requireAuth)
router.get('/catalogue', (_req, res) => res.json({ data: reportCatalogue }))
const escape = (v: unknown) =>
  String(v ?? 'Not recorded').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
router.get('/run/:type', async (req: AuthRequest, res) => {
  const type = req.params.type,
    definition = reportCatalogue.find((r) => r.id === type)
  if (!definition) {
    res.status(404).json({ error: 'Report not found' })
    return
  }
  const start = String(
      req.query.from || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
    ),
    end = String(req.query.to || new Date().toISOString().slice(0, 10))
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end)) ||
    start > end ||
    new Date(start).toISOString().slice(0, 10) !== start ||
    new Date(end).toISOString().slice(0, 10) !== end
  ) {
    res
      .status(400)
      .json({
        error: 'Choose a valid date range',
        fieldErrors: {
          from: 'Choose a valid start date',
          to: 'End date must be on or after the start date',
        },
      })
    return
  }
  const values: unknown[] = [
    req.user!.tenantId,
    start + 'T00:00:00Z',
    new Date(Date.parse(end + 'T00:00:00Z') + 86400000).toISOString(),
  ]
  let scope = 'wo.tenant_id=$1'
  for (const [key, column] of [
    ['departmentId', 'wo.department_id'],
    ['assetId', 'wo.asset_record_id'],
    ['formId', 'wo.work_instruction_id'],
  ] as const) {
    if (req.query[key]) {
      if (!/^[a-f0-9-]{36}$/i.test(String(req.query[key]))) {
        res.status(400).json({ error: 'Choose a valid report filter' })
        return
      }
      values.push(req.query[key])
      scope += ` AND ${column}=$${values.length}::uuid`
    }
  }
  const observationRows =
    type === 'completion-overdue'
      ? []
      : (
          await query(
            `SELECT ir.id AS "recordId",wo.id AS "workOrderId",wo.wo_number AS number,ir.completed_at AS date,coalesce(wo.asset_record_id::text,'legacy:'||wo.id::text) AS "assetId",coalesce(ir.signed_payload->>'assetNumber','Legacy asset') AS "assetNumber",coalesce(ir.signed_payload->>'assetName',wo.asset_name) AS asset,wo.department_id AS "departmentId",wo.work_instruction_id AS "formId",ir.signed_payload->>'formReference' AS form,ir.signed_payload->>'formRevision' AS revision,q->>'id' AS "itemId",q->>'lineage_id' AS lineage,q->>'description' AS description,coalesce(nullif(q->>'category',''),'Unclassified') AS classification,q->>'field_type' AS "fieldType",q->>'unit' AS unit,q->>'min_value' AS min,q->>'max_value' AS max,q->>'acceptance_criteria' AS criteria,q->>'conditional_json' AS policy,coalesce((q->>'assessment_required')::boolean,true) AS assessed,q->>'result' AS result,coalesce(q->>'captured_value','') AS value,coalesce((q->>'answered')::boolean,(q->>'result') IS NOT NULL) AS answered FROM public.inspection_records ir JOIN public.work_orders wo ON wo.id=ir.work_order_id AND wo.tenant_id=ir.tenant_id CROSS JOIN LATERAL jsonb_array_elements(ir.signed_payload->'items') q WHERE ${scope} AND ir.completed_at >= $2::timestamptz AND ir.completed_at < $3::timestamptz AND ir.signed_at IS NOT NULL AND ir.signature_hash IS NOT NULL AND coalesce(q->>'field_type','pass_fail')<>'heading'`,
            values,
          )
        ).rows
  let observations: Observation[] = observationRows.map((o) => ({
    ...o,
    date: new Date(o.date).toISOString(),
    min: o.min == null ? null : Number(o.min),
    max: o.max == null ? null : Number(o.max),
  }))
  if (req.query.category)
    observations = observations.filter((o) => o.classification === req.query.category)
  const orders =
    type === 'completion-overdue'
      ? (
          await query(
            `SELECT wo.*,u.name assigned_to_name FROM public.work_orders wo LEFT JOIN public.users u ON u.id=wo.assigned_to AND u.tenant_id=wo.tenant_id WHERE ${scope} AND wo.created_at >= $2::timestamptz AND wo.created_at < $3::timestamptz ORDER BY wo.due_date NULLS LAST,wo.id`,
            values,
          )
        ).rows
      : []
  const rows = buildReport(type, observations, orders, String(req.query.period || 'month'))
  const evaluated = observations.filter(
    (o) => o.assessed && ['pass', 'fail'].includes(o.result || ''),
  )
  const summary =
    type === 'completion-overdue'
      ? {
          workOrders: orders.length,
          assigned: orders.filter((o) => o.assigned_to).length,
          open: orders.filter((o) => o.status === 'open').length,
          inProgress: orders.filter((o) => o.status === 'in_progress').length,
          completed: orders.filter((o) => o.status === 'complete').length,
          overdue: rows.filter((o) => o.overdue).length,
        }
      : {
          signedInspections: new Set(observations.map((o) => o.recordId)).size,
          assessed: evaluated.length,
          failures: evaluated.filter((o) => o.result === 'fail').length,
          na: observations.filter((o) => o.result === 'na').length,
          informational: observations.filter((o) => !o.assessed && o.answered).length,
          unanswered: observations.filter((o) => !o.answered).length,
        }
  const coverage = {
    from: start,
    to: end,
    timeZone: 'UTC',
    basis:
      type === 'completion-overdue'
        ? 'Work orders created in range; current status and overdue evaluated now'
        : 'Completed signed inspections only; drafts and save events excluded',
    definition:
      'Assessed failure rate = failed assessed items / (passed + failed assessed items). N/A, informational answers and unanswered questions are excluded. Checkpoints use recorded lineage and compatible definitions; measurements also require the exact form revision and unit. Missing historical classifications are Unclassified.',
  }
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(safeCsv(rows, columns[type]))
    return
  }
  if (req.query.format === 'print') {
    res.setHeader('Cache-Control', 'private, no-store')
    res
      .type('html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escape(definition.name)}</title><style>@page{size:A4 landscape;margin:15mm}body{font:10pt Arial;color:#193047}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:2mm;border:1px solid #aaa;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${escape(definition.name)}</h1><p>${escape(start)} to ${escape(end)} UTC. ${escape(coverage.basis)}</p><p>${escape(coverage.definition)}</p><table><thead><tr>${columns[type].map(([, label]) => '<th>' + escape(label) + '</th>').join('')}</tr></thead><tbody>${rows.map((row) => '<tr>' + columns[type].map(([key]) => '<td>' + escape(row[key]) + '</td>').join('') + '</tr>').join('')}</tbody></table></body></html>`,
      )
    return
  }
  const page = Math.max(1, parseInt(String(req.query.page)) || 1),
    pageSize = Math.max(1, Math.min(100, parseInt(String(req.query.pageSize)) || 25))
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({
    data: rows.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: rows.length, hasMore: page * pageSize < rows.length },
    summary,
    coverage,
    columns: columns[type],
    chart: (type === 'measurement-trends' ? rows : rows.slice(0, 30)).map((row) => ({
      key: row.key,
      label:
        type === 'measurement-trends'
          ? [row.assetNumber, row.description, row.revision, row.unit].join(' / ')
          : row.assetNumber || row.description || row.period || row.number,
      value:
        row.failedItems ??
        row.failures ??
        row.failedInspections ??
        row.value ??
        (row.overdue ? 1 : 0),
      series: row.series,
      date: row.date,
      min: row.min,
      max: row.max,
      cumulativePercent:row.cumulativePercent,
    })),
  })
})
export default router
