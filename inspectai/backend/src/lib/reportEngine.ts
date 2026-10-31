import { createHash } from 'node:crypto'
export const reportCatalogue = [
  {
    id: 'failing-assets',
    name: 'Frequently failing assets',
    description: 'Rank signed failures alongside inspection exposure and assessed failure rates.',
  },
  {
    id: 'failure-pareto',
    name: 'Failure Pareto',
    description:
      'Stable checkpoints ranked by signed assessed failures, with cumulative percentage.',
  },
  {
    id: 'repeated-observations',
    name: 'Repeated failed observations',
    description:
      'The same asset/checkpoint failed in multiple distinct signed inspections. This does not establish repair and recurrence.',
  },
  {
    id: 'failure-trends',
    name: 'Failure trends',
    description: 'Weekly or monthly signed failures and assessed rates, with inspection volume.',
  },
  {
    id: 'completion-overdue',
    name: 'Inspection completion and overdue',
    description:
      'Current workload and actual due/completion dates for work orders created within the selected range.',
  },
  {
    id: 'measurement-trends',
    name: 'Measurement trends',
    description:
      'Comparable signed numeric readings, separated by asset, checkpoint, exact revision, units and recorded limits.',
  },
]
export interface Observation {
  recordId: string
  workOrderId: string
  number: string
  date: string
  assetId: string
  assetNumber: string
  asset: string
  departmentId: string
  formId: string
  form: string
  revision: string
  itemId: string
  lineage: string
  description: string
  classification: string
  fieldType: string
  unit: string
  min: number | null
  max: number | null
  criteria: string
  policy: string
  assessed: boolean
  result: string | null
  value: string
  answered: boolean
}
export type ReportRow = Record<string, unknown> & {
  key: string
  inspections: { id: string; number: string; date: string }[]
}
export const columns: Record<string, [string, string][]> = {
  'failing-assets': [
    ['assetNumber', 'Asset'],
    ['asset', 'Description'],
    ['failedItems', 'Failed items'],
    ['failedInspections', 'Inspections with failure'],
    ['inspectionsCount', 'Signed inspection exposure'],
    ['assessedInspections', 'Inspections with assessed checks'],
    ['assessedItems', 'Assessed items'],
    ['itemFailureRate', 'Assessed failure rate (%)'],
    ['inspectionFailureRate', 'Assessed inspections with failure (%)'],
  ],
  'failure-pareto': [
    ['description', 'Checkpoint'],
    ['classification', 'Classification'],
    ['failures', 'Failed assessed observations'],
    ['assessedItems', 'Assessed observations'],
    ['cumulativePercent', 'Cumulative failure (%)'],
  ],
  'repeated-observations': [
    ['assetNumber', 'Asset'],
    ['description', 'Checkpoint'],
    ['classification', 'Classification'],
    ['failedInspections', 'Distinct failed inspections'],
    ['dates', 'Inspection dates (UTC)'],
  ],
  'failure-trends': [
    ['period', 'Period (UTC)'],
    ['failures', 'Failed assessed observations'],
    ['assessedItems', 'Assessed observations'],
    ['inspectionsCount', 'Signed inspections'],
    ['failureRate', 'Assessed failure rate (%)'],
  ],
  'completion-overdue': [
    ['number', 'Work order'],
    ['asset', 'Asset'],
    ['assigned', 'Assigned inspector'],
    ['status', 'Current status'],
    ['due', 'Actual due date'],
    ['completed', 'Actual completion date'],
    ['overdue', 'Overdue now'],
  ],
  'measurement-trends': [
    ['assetNumber', 'Asset'],
    ['description', 'Checkpoint'],
    ['revision', 'Exact revision'],
    ['date', 'Signed date (UTC)'],
    ['value', 'Reading'],
    ['unit', 'Unit'],
    ['min', 'Recorded minimum'],
    ['max', 'Recorded maximum'],
    ['result', 'Recorded assessment'],
  ],
}
const rate = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 100 : null)
const links = (items: Observation[]) =>
  Array.from(
    new Map(
      items.map((i) => [i.recordId, { id: i.workOrderId, number: i.number, date: i.date }]),
    ).values(),
  ).sort((a, b) => a.date.localeCompare(b.date))
export function checkpoint(o: Observation) {
  return (
    (o.lineage || o.formId + ':' + o.itemId) +
    ':' +
    createHash('sha256')
      .update(
        JSON.stringify([o.fieldType, o.unit, o.min, o.max, o.criteria, o.policy, o.classification]),
      )
      .digest('hex')
      .slice(0, 16)
  )
}
const group = (items: Observation[], key: (o: Observation) => string) => {
  const map = new Map<string, Observation[]>()
  for (const o of items) {
    const k = key(o)
    map.set(k, [...(map.get(k) || []), o])
  }
  return map
}
export function buildReport(
  type: string,
  observations: Observation[],
  orders: Record<string, any>[] = [],
  period = 'month',
  now = Date.now(),
): ReportRow[] {
  const evaluated = observations.filter(
    (o) => o.assessed && ['pass', 'fail'].includes(o.result || ''),
  )
  const failed = evaluated.filter((o) => o.result === 'fail')
  if (type === 'completion-overdue')
    return orders.map((o) => ({
      key: o.id,
      number: o.wo_number,
      asset: o.asset_name,
      assigned: o.assigned_to_name || 'Unassigned',
      status: o.status,
      due: o.due_date ? new Date(o.due_date).toISOString() : null,
      completed: o.completed_at ? new Date(o.completed_at).toISOString() : null,
      overdue:
        !['complete', 'cancelled'].includes(o.status) &&
        !!o.due_date &&
        Date.parse(o.due_date) < now,
      inspections: [{ id: o.id, number: o.wo_number, date: o.completed_at || o.created_at }],
    }))
  if (type === 'failing-assets')
    return [...group(observations, (o) => o.assetId).entries()]
      .map(([key, items]) => {
        const assessed = items.filter(
            (o) => o.assessed && ['pass', 'fail'].includes(o.result || ''),
          ),
          fail = assessed.filter((o) => o.result === 'fail'),
          exposure = links(items).length,
          failedInspections = links(fail).length
        return {
          key,
          assetNumber: items[0].assetNumber,
          asset: items[0].asset,
          failedItems: fail.length,
          failedInspections,
          inspectionsCount: exposure,
          assessedInspections: links(assessed).length,
          assessedItems: assessed.length,
          itemFailureRate: rate(fail.length, assessed.length),
          inspectionFailureRate: rate(failedInspections, links(assessed).length),
          inspections: links(items),
        }
      })
      .sort((a, b) => b.failedItems - a.failedItems || a.key.localeCompare(b.key))
  if (type === 'failure-pareto') {
    let running = 0
    return [...group(failed, checkpoint).entries()]
      .map(([key, items]) => ({
        key,
        description: items[0].description,
        classification: items[0].classification,
        failures: items.length,
        assessedItems: evaluated.filter((o) => checkpoint(o) === key).length,
        inspections: links(items),
      }))
      .sort((a, b) => b.failures - a.failures || a.key.localeCompare(b.key))
      .map((row) => ({ ...row, cumulativePercent: rate((running += row.failures), failed.length) }))
  }
  if (type === 'repeated-observations')
    return [...group(failed, (o) => o.assetId + ':' + checkpoint(o)).entries()]
      .map(([key, items]) => ({
        key,
        assetNumber: items[0].assetNumber,
        description: items[0].description,
        classification: items[0].classification,
        failedInspections: links(items).length,
        dates: links(items)
          .map((i) => i.date)
          .join('; '),
        inspections: links(items),
      }))
      .filter((o) => o.failedInspections >= 2)
      .sort((a, b) => b.failedInspections - a.failedInspections || a.key.localeCompare(b.key))
  if (type === 'failure-trends')
    return [
      ...group(observations, (o) => {
        const d = new Date(o.date)
        if (period === 'week') {
          d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
          return d.toISOString().slice(0, 10)
        }
        return d.toISOString().slice(0, 7)
      }).entries(),
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => {
        const assessed = items.filter(
            (o) => o.assessed && ['pass', 'fail'].includes(o.result || ''),
          ),
          failures = assessed.filter((o) => o.result === 'fail').length
        return {
          key,
          period: key,
          failures,
          assessedItems: assessed.length,
          inspectionsCount: links(items).length,
          failureRate: rate(failures, assessed.length),
          inspections: links(items),
        }
      })
  if (type === 'measurement-trends')
    return observations
      .filter(
        (o) =>
          ['number', 'measurement'].includes(o.fieldType) &&
          o.value.trim() &&
          Number.isFinite(Number(o.value)),
      )
      .map((o) => ({
        key: o.recordId + ':' + o.itemId,
        series: o.assetId + ':' + o.formId + ':' + checkpoint(o),
        assetNumber: o.assetNumber,
        description: o.description,
        revision: o.revision,
        date: o.date,
        value: Number(o.value),
        unit: o.unit || 'Unit not recorded',
        min: o.min,
        max: o.max,
        result: o.assessed ? o.result || 'Unanswered' : 'Information only',
        inspections: links([o]),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  throw new Error('Unknown report')
}
export function safeCsv(rows: Record<string, unknown>[], fields: [string, string][]): string {
  const cell = (v: unknown) => {
    let text = String(v ?? '')
    if (typeof v === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return (
    '\ufeff' +
    [
      fields.map(([, label]) => cell(label)).join(','),
      ...rows.map((row) => fields.map(([key]) => cell(row[key])).join(',')),
    ].join('\r\n')
  )
}
