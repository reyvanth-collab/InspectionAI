import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Button } from '@/components/ui/Button'
import { RecordPageSummary } from '@/components/ui/RecordPageSummary'
import { ValidationSummary } from '@/components/ui/ValidationSummary'
import { useDepartments } from '@/hooks/useDepartments'
import { api } from '@/lib/api'
interface Definition {
  id: string
  name: string
  description: string
}
interface ChartPoint {
  cumulativePercent?: number
  key: string
  label: string
  value: number
  series?: string
  date?: string
  min?: number
  max?: number
}
interface Report {
  data: Record<string, unknown>[]
  meta: { page: number; pageSize: number; total: number; hasMore: boolean }
  summary: Record<string, number>
  coverage: { from: string; to: string; basis: string; definition: string }
  columns: [string, string][]
  chart: ChartPoint[]
}
async function allOptions(path: string) {
  const rows: Record<string, string>[] = []
  for (let page = 1; page <= 1000; page++) {
    const r = await api.get<{ data: Record<string, string>[]; meta?: { hasMore: boolean } }>(
      path + '?pageSize=100&page=' + page,
    )
    rows.push(...r.data.data)
    if (!r.data.meta?.hasMore) return rows
  }
  throw Error('Too many filter options')
}
export default function Reports() {
  const [selected, setSelected] = useState<Definition | null>(null)
  const catalogue = useQuery({
    queryKey: ['report-catalogue'],
    queryFn: async () => (await api.get<{ data: Definition[] }>('/reports/catalogue')).data.data,
  })
  return (
    <AppLayout breadcrumb={[{ label: 'Reports' }]}>
      <h1 className="text-2xl font-semibold mb-3">Reports</h1>
      {selected ? (
        <>
          <Button variant="secondary" onClick={() => setSelected(null)}>
            Back to report catalogue
          </Button>
          <RunReport key={selected.id} definition={selected} />
        </>
      ) : (
        <>
          <p className="text-text-2 mb-6">
            Choose a report to explore authorised inspection evidence and workload. Individual
            signed PDFs are available from each inspection.
          </p>
          {catalogue.isLoading && <p role="status">Loading report catalogue…</p>}
          {catalogue.error && (
            <p role="alert">
              Report catalogue could not be loaded.{' '}
              <button onClick={() => void catalogue.refetch()}>Retry catalogue</button>
            </p>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            {catalogue.data?.map((d) => (
              <section key={d.id} className="execution-card">
                <h2 className="text-lg font-semibold">{d.name}</h2>
                <p className="text-sm text-text-2 my-3">{d.description}</p>
                <Button variant="primary" onClick={() => setSelected(d)}>
                  Run {d.name}
                </Button>
              </section>
            ))}
          </div>
        </>
      )}
    </AppLayout>
  )
}
function RunReport({ definition }: { definition: Definition }) {
  const { data: departments = [] } = useDepartments()
  const [from, setFrom] = useState(
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [department, setDepartment] = useState(''),
    [asset, setAsset] = useState(''),
    [form, setForm] = useState(''),
    [category, setCategory] = useState(''),
    [period, setPeriod] = useState('month'),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [series, setSeries] = useState('')
  const assets = useQuery({
    queryKey: ['report-asset-options'],
    queryFn: () => allOptions('/assets'),
  })
  const forms = useQuery({
    queryKey: ['report-form-options'],
    queryFn: () => allOptions('/work-instructions'),
  })
  const valid = !!from && !!to && from <= to
  const params = new URLSearchParams({
    from,
    to,
    departmentId: department,
    assetId: asset,
    formId: form,
    category,
    period,
    page: String(page),
    pageSize: '25',
  })
  const query = useQuery({
    queryKey: ['report-run', definition.id, params.toString()],
    enabled: valid,
    queryFn: async () =>
      (await api.get<Report>('/reports/run/' + definition.id + '?' + params)).data,
  })
  const filter = (set: (v: string) => void, v: string) => {
    set(v)
    setPage(1)
    setSeries('')
  }
  async function output(format: 'csv' | 'print') {
    setBusy(true)
    setMessage('')
    try {
      const options = new URLSearchParams(params)
      options.set('format', format)
      const r = await api.get('/reports/run/' + definition.id + '?' + options, {
        responseType: format === 'csv' ? 'blob' : 'text',
      })
      if (format === 'csv') {
        const url = URL.createObjectURL(r.data)
        const a = document.createElement('a')
        a.href = url
        a.download = definition.id + '.csv'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      } else {
        const frame = document.createElement('iframe')
        frame.title = 'Printable filtered report'
        frame.style.position = 'fixed'
        frame.style.width = '1px'
        frame.style.height = '1px'
        frame.style.opacity = '0'
        frame.srcdoc = String(r.data)
        frame.onload = () => {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          frame.dataset.printReady = 'true'
        }
        document.body.appendChild(frame)
        setTimeout(() => frame.remove(), 120000)
      }
    } catch {
      setMessage('Export or print failed. Retry after the report is available.')
    } finally {
      setBusy(false)
    }
  }
  const data = query.data,
    measurement = definition.id === 'measurement-trends',
    seriesIds = [...new Set(data?.chart.map((p) => p.series).filter((v): v is string => !!v))],
    activeSeries = series || seriesIds[0],
    chart = measurement ? data?.chart.filter((p) => p.series === activeSeries) : data?.chart
  return (
    <section className="mt-5">
      <h2 className="text-xl font-semibold mb-2">{definition.name}</h2>
      <p className="text-text-2 mb-4">{definition.description}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <label className="field-label">
          From (UTC)
          <input
            id="report-from"
            aria-label="Report from"
            type="date"
            className="field-input mt-1"
            value={from}
            onChange={(e) => filter(setFrom, e.target.value)}
          />
        </label>
        <label className="field-label">
          To (UTC)
          <input
            id="report-to"
            aria-label="Report to"
            type="date"
            className="field-input mt-1"
            value={to}
            onChange={(e) => filter(setTo, e.target.value)}
          />
        </label>
        <label className="field-label">
          Department
          <select
            className="field-input mt-1"
            value={department}
            onChange={(e) => filter(setDepartment, e.target.value)}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Asset
          <select
            className="field-input mt-1"
            value={asset}
            onChange={(e) => filter(setAsset, e.target.value)}
          >
            <option value="">All assets</option>
            {assets.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.asset_number} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Form / revision
          <select
            className="field-input mt-1"
            value={form}
            onChange={(e) => filter(setForm, e.target.value)}
          >
            <option value="">All authorised forms</option>
            {forms.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.wi_number} · {f.revision}
              </option>
            ))}
          </select>
        </label>
        {definition.id !== 'completion-overdue' && (
          <label className="field-label">
            Classification
            <input
              className="field-input mt-1"
              placeholder="All classifications"
              value={category}
              onChange={(e) => filter(setCategory, e.target.value)}
            />
          </label>
        )}
        {definition.id === 'failure-trends' && (
          <label className="field-label">
            Grouping
            <select
              className="field-input mt-1"
              value={period}
              onChange={(e) => filter(setPeriod, e.target.value)}
            >
              <option value="month">Monthly</option>
              <option value="week">Weekly (Monday UTC)</option>
            </select>
          </label>
        )}
      </div>
      <ValidationSummary
        issues={
          !valid
            ? [
                {
                  id: !from ? 'report-from' : 'report-to',
                  message: 'Choose a valid date range; end date must be on or after start date',
                },
              ]
            : []
        }
      />
      {(assets.error || forms.error) && (
        <p role="alert">
          Some report filter options could not be loaded.{' '}
          <button onClick={() => void Promise.all([assets.refetch(), forms.refetch()])}>
            Retry filter options
          </button>
        </p>
      )}
      {query.isLoading && <p role="status">Calculating over the full authorised dataset…</p>}
      {query.error && (
        <div role="alert" className="execution-card">
          <p>This report could not be loaded. Retry before using or exporting its results.</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry report
          </Button>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
      <div className="flex gap-3 my-4">
        <Button
          variant="secondary"
          loading={busy}
          disabled={!data || !!query.error || !valid || query.isFetching}
          onClick={() => void output('csv')}
        >
          Export filtered CSV
        </Button>
        <Button
          variant="secondary"
          loading={busy}
          disabled={!data || !!query.error || !valid || query.isFetching}
          onClick={() => void output('print')}
        >
          Print filtered report
        </Button>
      </div>
      {data && !query.error && (
        <>
          <p className="text-sm mb-2">
            {data.coverage.from} to {data.coverage.to} UTC · {data.coverage.basis}
          </p>
          <p className="text-sm text-text-2 mb-4">{data.coverage.definition}</p>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {Object.entries(data.summary).map(([key, value]) => (
              <div className="execution-card" key={key}>
                <dt className="text-sm">{key.replace(/([A-Z])/g, ' $1')}</dt>
                <dd className="text-xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {measurement && seriesIds.length > 0 && (
            <label className="field-label">
              Comparable measurement series
              <select
                className="field-input my-2"
                value={activeSeries}
                onChange={(e) => setSeries(e.target.value)}
              >
                {seriesIds.map((id) => {
                  const point = data.chart.find((p) => p.series === id)
                  return (
                    <option value={id} key={id}>
                      {point?.label} · {id.slice(-12)}
                    </option>
                  )
                })}
              </select>
            </label>
          )}
          {chart && chart.length > 0 && (
            <ReportChart
              points={chart}
              measurement={measurement}
              pareto={definition.id === 'failure-pareto'}
            />
          )}
          {!data.data.length ? (
            <p className="execution-card" role="status">
              No matching evidence for this report and date range.
            </p>
          ) : (
            <div className="overflow-auto">
              <table className="record-table" aria-label={definition.name}>
                <thead>
                  <tr>
                    {data.columns.map(([key, label]) => (
                      <th scope="col" key={key}>
                        {label}
                      </th>
                    ))}
                    <th scope="col">Supporting inspections</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row) => (
                    <tr key={String(row.key)}>
                      {data.columns.map(([key]) => (
                        <td key={key}>{row[key] == null ? 'Not recorded' : String(row[key])}</td>
                      ))}
                      <td>
                        <details>
                          <summary>Open supporting records</summary>
                          <ul>
                            {(
                              row.inspections as { id: string; number: string; date: string }[]
                            ).map((i) => (
                              <li key={i.id}>
                                <Link className="text-accent" to={'/inspections/' + i.id}>
                                  {i.number} · {i.date?.slice(0, 10)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-3 items-center justify-between mt-4">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <RecordPageSummary
              page={page}
              pageSize={25}
              total={data.meta.total}
              count={data.data.length}
              label="report rows"
            />
            <Button
              variant="secondary"
              disabled={!data.meta.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
function ReportChart({
  points,
  measurement,
  pareto,
}: {
  points: ChartPoint[]
  measurement: boolean
  pareto: boolean
}) {
  const min = Math.min(0, ...points.map((p) => p.value), ...points.map((p) => p.min ?? 0)),
    max = Math.max(1, ...points.map((p) => p.value), ...points.map((p) => p.max || 0)),
    range = max - min || 1
  const y = (value: number) => 180 - ((value - min) / range) * 150
  return (
    <figure className="execution-card mb-4">
      <figcaption className="text-sm mb-3">
        {measurement
          ? 'One compatible measurement series in date order. Recorded limits remain visible in the data table.'
          : 'Top 30 matching groups; the table and export contain all matching groups. Counts show volume; consult rates and denominators before interpreting trends.'}
      </figcaption>
      <svg
        viewBox="0 0 800 240"
        role="img"
        aria-label={measurement ? 'Measurement trend' : 'Report count chart'}
        className="w-full"
      >
        <line x1="30" x2="790" y1="180" y2="180" stroke="currentColor" />
        <text x="2" y="30" fontSize="10">
          {max}
        </text>
        <text x="2" y="180" fontSize="10">
          {min}
        </text>
        {measurement &&
          (['min', 'max'] as const).map(
            (key) =>
              points[0][key] != null && (
                <g key={key}>
                  <line
                    x1="35"
                    x2="780"
                    y1={y(points[0][key]!)}
                    y2={y(points[0][key]!)}
                    stroke="#b05c00"
                    strokeDasharray="6 4"
                  />
                  <text x="42" y={y(points[0][key]!) - 5} fontSize="10">
                    Recorded {key}: {points[0][key]}
                  </text>
                </g>
              ),
          )}
        {measurement && (
          <>
            <text x="40" y="215" fontSize="10">
              {points[0].date?.slice(0, 10)}
            </text>
            <text x="780" y="215" textAnchor="end" fontSize="10">
              {points[points.length - 1].date?.slice(0, 10)} UTC
            </text>
          </>
        )}
        {pareto && (
          <>
            <polyline
              fill="none"
              stroke="#b05c00"
              strokeWidth="2"
              points={points
                .map(
                  (p, i) =>
                    `${35 + (i * 750) / points.length + 325 / points.length},${180 - (p.cumulativePercent || 0) * 1.5}`,
                )
                .join(' ')}
            />
            <text x="790" y="20" textAnchor="end" fontSize="10">
              100% cumulative
            </text>
          </>
        )}
        {measurement ? (
          <polyline
            fill="none"
            stroke="#175b9c"
            strokeWidth="3"
            points={points
              .map((p, i) => `${40 + (i * 730) / Math.max(1, points.length - 1)},${y(p.value)}`)
              .join(' ')}
          />
        ) : (
          points.map((p, i) => (
            <g key={p.key}>
              <rect
                x={35 + (i * 750) / points.length}
                y={y(p.value)}
                width={Math.max(2, 650 / points.length)}
                height={180 - y(p.value)}
                fill="#175b9c"
              />
              <title>
                {p.label}: {p.value}
              </title>
              <text x={35 + (i * 750) / points.length} y="200" fontSize="10">
                {i + 1}
              </text>
            </g>
          ))
        )}
        {measurement &&
          points.map((p, i) => (
            <circle
              key={p.key}
              cx={40 + (i * 730) / Math.max(1, points.length - 1)}
              cy={y(p.value)}
              r="4"
              fill="#175b9c"
            >
              <title>
                {p.date}: {p.value}
              </title>
            </circle>
          ))}
      </svg>
      <p className="text-xs text-text-2">
        {pareto &&
          'Blue bars: failures. Orange line: cumulative percentage of all filtered failures. '}
        The accessible data table below gives exact values and supporting inspections.
      </p>
    </figure>
  )
}
