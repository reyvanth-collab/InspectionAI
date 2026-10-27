import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHero } from '@/components/ui/PageHero'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { useInspectionSummary, useWICompliance, useDefectAnalysis, type ReportDays } from '@/hooks/useReports'

type Tab = 'inspection-summary' | 'wi-compliance' | 'defect-analysis'
const tabs: { id: Tab; label: string }[] = [
  { id: 'inspection-summary', label: 'Inspection summary' },
  { id: 'wi-compliance', label: 'Form compliance' },
  { id: 'defect-analysis', label: 'Defect analysis' },
]
const statusLabels: Record<string, string> = {
  active: 'Published', expiring: 'Published · expires soon', expired: 'Expired',
  draft: 'Draft', pending_approval: 'Awaiting approval', superseded: 'Previous version',
}
const statusBadges: Record<string, BadgeVariant> = {
  active: 'active', expiring: 'expiring', expired: 'expired', draft: 'draft',
  pending_approval: 'pending_approval', superseded: 'superseded',
}
function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}-${Date.now()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'
}
function ReportError({ retry }: { retry: () => void }) {
  return <div role="alert" className="execution-card border-danger-border mb-4">
    <p className="text-danger mb-3">This report could not be loaded. Try again before using or exporting its results.</p>
    <Button variant="secondary" onClick={retry}>Retry report</Button>
  </div>
}
function Metrics({ values }: { values: [string, string | number][] }) {
  return <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">{values.map(([label, value]) =>
    <div className="execution-card" key={label}><dt className="text-sm text-text-2">{label}</dt><dd className="text-2xl font-semibold mt-2 tabular-nums">{value}</dd></div>,
  )}</dl>
}
function Period({ value, onChange }: { value: ReportDays; onChange: (days: ReportDays) => void }) {
  return <label className="flex items-center gap-2 text-sm">Period
    <select className="field-input w-auto" value={value} onChange={e => onChange(e.target.value as ReportDays)}>
      {(['7', '30', '90', '180', '365'] as ReportDays[]).map(days => <option key={days} value={days}>Last {days} days</option>)}
    </select>
  </label>
}
function Empty({ children }: { children: string }) {
  return <p className="execution-card text-text-2" role="status">{children}</p>
}
function Result({ result }: { result: string | null }) {
  return result === 'pass' || result === 'fail'
    ? <Badge variant={result === 'pass' ? 'active' : 'expired'}>{result === 'pass' ? 'Pass' : 'Fail'}</Badge>
    : <Badge variant="draft">{result === 'na' ? 'N/A' : 'No evaluated result'}</Badge>
}
function InspectionSummary() {
  const [days, setDays] = useState<ReportDays>('30')
  const query = useInspectionSummary(days)
  const data = query.data ?? []
  const pass = data.reduce((sum, row) => sum + Number(row.pass_count), 0)
  const fail = data.reduce((sum, row) => sum + Number(row.fail_count), 0)
  const evaluated = pass + fail
  const available = !query.isPending && !query.isError && !query.isFetching
  return <section aria-label="Inspection summary report">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <Period value={days} onChange={setDays} />
      <Button variant="secondary" disabled={!available || !data.length} onClick={() => downloadJson('inspection-summary', data)}>Export JSON</Button>
    </div>
    {query.isError ? <ReportError retry={() => void query.refetch()} /> : query.isPending ? <SkeletonTable rows={4} /> : <>
      <Metrics values={[
        ['Completed inspections', data.length], ['Passed items', pass], ['Failed items', fail],
        ['Evaluated pass rate', evaluated ? `${Math.round(pass / evaluated * 100)}%` : '—'],
      ]} />
      <p className="text-sm text-text-2 mb-4">Completed within the selected period. Pass rate uses Pass and Fail answers only; N/A and unanswered items are excluded.</p>
      {!data.length ? <Empty>No completed inspections in this period.</Empty> : <div className="grid gap-3">
        {data.map(row => <article key={row.work_order_id} className="execution-card">
          <div className="flex flex-wrap justify-between gap-3 mb-3">
            <Link className="text-accent font-semibold break-all" to={`/inspections/${row.work_order_id}`}>{row.wo_number}</Link>
            <Result result={row.overall_result} />
          </div>
          <h2 className="font-medium break-words">{row.asset_name}</h2>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 text-sm">
            {[
              ['Location', row.location || '—'], ['Inspector', row.inspector_name || '—'],
              ['Completed', date(row.completed_at)], ['Form reference', row.wi_number || '—'],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-text-2">{label}</dt><dd className="break-words mt-1">{value}</dd></div>)}
          </dl>
          <p className="text-sm mt-4">Pass: {row.pass_count} · Fail: {row.fail_count} · Saved responses: {row.total_findings}</p>
        </article>)}
      </div>}
    </>}
  </section>
}
function FormCompliance() {
  const query = useWICompliance()
  const data = query.data ?? []
  return <section aria-label="Form compliance report">
    <div className="flex justify-end mb-4"><Button variant="secondary" disabled={query.isPending || query.isError || query.isFetching || !data.length} onClick={() => downloadJson('form-compliance', data)}>Export JSON</Button></div>
    {query.isError ? <ReportError retry={() => void query.refetch()} /> : query.isPending ? <SkeletonTable rows={4} /> : <>
      <Metrics values={[
        ['Published', data.filter(row => ['active', 'expiring'].includes(row.status)).length],
        ['Expired', data.filter(row => row.status === 'expired').length],
        ['Drafts', data.filter(row => row.status === 'draft').length],
        ['Awaiting approval', data.filter(row => row.status === 'pending_approval').length],
      ]} />
      {!data.length ? <Empty>No inspection forms found.</Empty> : <div className="grid gap-3 md:grid-cols-2">
        {data.map(row => <article className="execution-card min-w-0" key={row.id}>
          <div className="flex flex-wrap gap-3 items-start justify-between mb-3">
            <Link className="text-accent font-semibold break-all" to={`/library/${row.id}`}>{row.wi_number}</Link>
            <Badge variant={statusBadges[row.status] ?? 'draft'}>{statusLabels[row.status] ?? row.status}</Badge>
          </div>
          <h2 className="font-medium break-words">{row.title}</h2>
          <p className="text-sm text-text-2 mt-3">Revision {row.revision} · {row.owner_name || 'Owner not recorded'}</p>
          <p className="text-sm mt-2">Effective: {date(row.effective_date)} · Expires: {date(row.expiry_date)}</p>
        </article>)}
      </div>}
    </>}
  </section>
}
function DefectAnalysis() {
  const [days, setDays] = useState<ReportDays>('30')
  const query = useDefectAnalysis(days)
  const data = query.data ?? []
  return <section aria-label="Defect analysis report">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <Period value={days} onChange={setDays} />
      <Button variant="secondary" disabled={query.isPending || query.isError || query.isFetching || !data.length} onClick={() => downloadJson('defect-analysis', data)}>Export JSON</Button>
    </div>
    {query.isError ? <ReportError retry={() => void query.refetch()} /> : query.isPending ? <SkeletonTable rows={4} /> : <>
      <Metrics values={[
        ['Failed responses', data.reduce((sum, row) => sum + Number(row.fail_count), 0)],
        ['Question groups', data.length],
      ]} />
      <p className="text-sm text-text-2 mb-4">Failures from inspections started in this period, including inspections still in progress. Questions with the same description and category are grouped together.</p>
      {!data.length ? <Empty>No failures recorded in this period.</Empty> : <div className="grid gap-3">
        {data.map((row, index) => <article className="execution-card min-w-0" key={index}>
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="font-medium break-words min-w-0 flex-1">{row.item_description}</h2><Badge variant="expired">{row.fail_count} failed</Badge></div>
          <p className="text-sm text-text-2 mt-2 break-words">{row.category}</p>
          {row.sample_notes && <p className="text-sm mt-3 whitespace-pre-wrap break-words">{row.sample_notes}</p>}
        </article>)}
      </div>}
    </>}
  </section>
}
export default function Reports() {
  const [tab, setTab] = useState<Tab>('inspection-summary')
  return <AppLayout breadcrumb={[{ label: 'Reports' }]}>
    <PageHero eyebrow="Reports" title="Reports" description="Review inspection outcomes, failed items and form compliance." icon={BarChart3} />
    <div role="group" aria-label="Report type" className="flex flex-wrap gap-2 mb-6">
      {tabs.map(item => <Button key={item.id} variant={tab === item.id ? 'primary' : 'secondary'} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}
    </div>
    {tab === 'inspection-summary' && <InspectionSummary />}
    {tab === 'wi-compliance' && <FormCompliance />}
    {tab === 'defect-analysis' && <DefectAnalysis />}
  </AppLayout>
}
