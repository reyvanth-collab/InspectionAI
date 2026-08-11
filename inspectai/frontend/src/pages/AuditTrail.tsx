import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Clock3, FileText, Search } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { useAuditLogs, type AuditLog } from '@/hooks/useAuditLogs'

const PAGE_SIZE = 50
const TABLE_OPTIONS = ['', 'work_instructions', 'work_orders', 'inspection_records', 'approval_records', 'users']
const TABLE_LABELS: Record<string, string> = {
  '': 'All activity', work_instructions: 'Work instructions', work_orders: 'Work orders',
  inspection_records: 'Inspections', approval_records: 'Approvals', users: 'Users',
}

function relativeTime(iso: string) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60_000), hours = Math.floor(diff / 3_600_000), days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-SG')
}

function actionLabel(action: string) {
  return action.split(/[._]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function actionVariant(log: AuditLog): BadgeVariant {
  const action = log.action.toLowerCase()
  if (log.severity === 'critical' || action.includes('delete') || action.includes('reject')) return 'rejected'
  if (log.severity === 'warning' || action.includes('update') || action.includes('submit')) return 'expiring'
  return 'active'
}

function detailText(log: AuditLog) {
  const detail = log.detail ?? {}
  const value = detail.step ?? detail.reason ?? detail.wi_number ?? detail.wo_number ?? detail.status
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

interface AuditGroup {
  key: string
  wiId: string | null
  wiNumber: string
  title: string
  revision: string | null
  status: string | null
  logs: AuditLog[]
}

function groupLogs(logs: AuditLog[]) {
  const groups = new Map<string, AuditGroup>()
  for (const log of logs) {
    const key = log.wi_id ?? `other:${log.table_name}`
    const existing = groups.get(key)
    if (existing) { existing.logs.push(log); continue }
    groups.set(key, {
      key, wiId: log.wi_id,
      wiNumber: log.wi_number ?? (log.wi_id ? 'Work instruction' : 'System activity'),
      title: log.wi_title ?? TABLE_LABELS[log.table_name] ?? log.table_name,
      revision: log.wi_revision, status: log.wi_status, logs: [log],
    })
  }
  return [...groups.values()].sort((a, b) => new Date(b.logs[0].created_at).getTime() - new Date(a.logs[0].created_at).getTime())
}

function EventRow({ log }: { log: AuditLog }) {
  return (
    <div className="relative flex gap-3 border-b border-border px-5 py-4 last:border-0">
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-2 bg-bg-2 text-text-2"><Activity size={14} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={actionVariant(log)}>{actionLabel(log.action)}</Badge><span className="text-[12px] text-text">{log.performed_by_name ?? 'System'}</span><span className="text-[11px] text-text-3">{relativeTime(log.created_at)}</span></div>
        {detailText(log) && <p className="mt-1 text-[12px] text-text-2">{detailText(log)}</p>}
        <p className="mt-1 text-[10px] text-text-3">{new Date(log.created_at).toLocaleString('en-SG')}</p>
      </div>
    </div>
  )
}

function statusVariant(status: string | null): BadgeVariant {
  if (status === 'active') return 'active'
  if (status === 'draft') return 'draft'
  if (status === 'expired') return 'expired'
  return 'pending'
}

export default function AuditTrail() {
  const [tableFilter, setTableFilter] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const { data: logs = [], isLoading } = useAuditLogs(limit, tableFilter || undefined)

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase()
    return groupLogs(logs.filter(log => !term || [log.wi_number, log.wi_title, log.wi_revision, log.action, log.performed_by_name]
      .some(value => value?.toLowerCase().includes(term))))
  }, [logs, search])
  const selected = groups.find(group => group.key === selectedKey) ?? groups[0] ?? null
  const wiGroups = groups.filter(group => group.wiId)
  const warningCount = logs.filter(log => log.severity === 'warning' || log.severity === 'critical').length
  const canLoadMore = logs.length === limit

  return (
    <AppLayout breadcrumb={[{ label: 'Audit Trail' }]}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-[22px] font-semibold tracking-[-0.3px]">Audit Trail</h1><p className="mt-1 text-[13px] text-text-2">Find a work instruction and review its complete change history</p></div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-2 px-3 py-2 text-[11px] text-text-2"><Clock3 size={14} className="text-accent" /> Latest changes first</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="WI records" value={wiGroups.length} sub="With tracked history" color="accent" />
        <StatCard label="Events loaded" value={logs.length} sub="Auditable changes" />
        <StatCard label="Attention" value={warningCount} sub="Warnings or critical" color="amber" />
        <StatCard label="Other activity" value={groups.filter(group => !group.wiId).length} sub="Not linked to a WI" />
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="relative min-w-0"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search WI number, title, revision, action, or user..." className="w-full rounded-md border border-border-2 bg-bg py-2 pl-10 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-3 focus:border-accent" /></div>
          <div className="flex items-center gap-2"><label className="text-[11px] uppercase tracking-[0.07em] text-text-3">Scope</label><select value={tableFilter} onChange={e => { setTableFilter(e.target.value); setLimit(PAGE_SIZE); setSelectedKey(null) }} className="rounded-md border border-border-2 bg-bg-2 px-3 py-2 text-[12px] text-text outline-none focus:border-accent">{TABLE_OPTIONS.map(option => <option key={option} value={option}>{TABLE_LABELS[option]}</option>)}</select></div>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <Card className="mb-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-[13px] font-semibold text-text">Work instructions</h2><p className="mt-0.5 text-[11px] text-text-3">Select a record to inspect</p></div><span className="font-mono text-[11px] text-text-3">{groups.length}</span></div>
          {isLoading ? <div className="flex flex-col gap-3 p-3">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 rounded-md shimmer" />)}</div> : groups.length === 0 ? <CardBody><p className="py-8 text-center text-[12px] text-text-3">No matching records</p></CardBody> : <div className="max-h-[620px] overflow-y-auto">{groups.map(group => { const active = selected?.key === group.key; const latest = group.logs[0]; return <button key={group.key} onClick={() => setSelectedKey(group.key)} className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 ${active ? 'bg-accent-bg' : 'hover:bg-bg-3'}`}><div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${active ? 'bg-accent text-white' : 'bg-bg-3 text-text-2'}`}>{group.wiId ? <FileText size={14} /> : <Activity size={14} />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`truncate font-mono text-[11px] ${active ? 'text-accent' : 'text-text-2'}`}>{group.wiNumber}</span>{group.revision && <span className="shrink-0 text-[10px] text-text-3">{group.revision}</span>}</div><p className="mt-1 truncate text-[12px] font-medium text-text">{group.title}</p><p className="mt-1 truncate text-[10px] text-text-3">{actionLabel(latest.action)} · {relativeTime(latest.created_at)}</p></div><span className="mt-1 shrink-0 rounded-full bg-bg-3 px-2 py-0.5 font-mono text-[10px] text-text-2">{group.logs.length}</span></button> })}</div>}
          {canLoadMore && <div className="border-t border-border p-3"><Button className="w-full" variant="secondary" size="sm" onClick={() => setLimit(value => value + PAGE_SIZE)}>Load more records</Button></div>}
        </Card>

        <Card className="mb-0 min-h-[420px] overflow-hidden">
          {!selected ? <CardBody><div className="flex min-h-[380px] flex-col items-center justify-center text-center"><Search size={24} className="mb-3 text-text-3" /><p className="text-[13px] text-text-2">Select a work instruction</p><p className="mt-1 max-w-xs text-[12px] text-text-3">Choose a record from the list to see its approvals, revisions, and operational changes.</p></div></CardBody> : <><div className="border-b border-border px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-accent">{selected.wiNumber}</span>{selected.revision && <Badge variant="pending">{selected.revision}</Badge>}{selected.status && <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>}</div><h2 className="mt-2 truncate text-[16px] font-semibold text-text">{selected.title}</h2><p className="mt-1 text-[11px] text-text-3">{selected.logs.length} recorded events · Last changed {relativeTime(selected.logs[0].created_at)}</p></div><span className="flex items-center gap-1 text-[11px] text-text-3"><Activity size={14} /> Change history</span></div></div><div className="flex items-center gap-4 border-b border-border bg-bg-3 px-5 py-3 text-[11px] text-text-2"><span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-success" /> {selected.logs.filter(log => log.severity === 'info').length} informational</span><span className="flex items-center gap-1.5"><AlertTriangle size={13} className="text-warning" /> {selected.logs.filter(log => log.severity === 'warning' || log.severity === 'critical').length} attention</span></div><div className="relative">{selected.logs.map(log => <EventRow key={log.id} log={log} />)}</div></>}
        </Card>
      </div>

      {warningCount > 0 && <div className="mt-4 flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-[11px] text-warning"><AlertTriangle size={14} /> {warningCount} audit event{warningCount === 1 ? '' : 's'} need attention.</div>}
    </AppLayout>
  )
}
