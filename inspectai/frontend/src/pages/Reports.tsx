import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { SkeletonTable } from '@/components/ui/Skeleton'
import {
  useInspectionSummary,
  useWICompliance,
  useDefectAnalysis,
  type ReportDays,
  type InspectionSummaryRow,
  type WIComplianceRow,
  type DefectAnalysisRow,
} from '@/hooks/useReports'
import { useAuditLogs, type AuditLog } from '@/hooks/useAuditLogs'
import type { BadgeVariant } from '@/components/ui/Badge'

type Tab = 'inspection-summary' | 'wi-compliance' | 'defect-analysis' | 'audit-trail'

const TABS: { id: Tab; label: string }[] = [
  { id: 'inspection-summary', label: 'Inspection Summary' },
  { id: 'wi-compliance',      label: 'WI Compliance'      },
  { id: 'defect-analysis',    label: 'Defect Analysis'    },
  { id: 'audit-trail',        label: 'Audit Trail'        },
]

const STATUS_BADGE: Record<string, BadgeVariant> = {
  active: 'active', expiring: 'expiring', expired: 'expired',
  draft: 'draft', pending_approval: 'pending_approval', superseded: 'superseded',
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${filename}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function DaysSelect({ value, onChange }: { value: ReportDays; onChange: (v: ReportDays) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as ReportDays)}
      className="px-3 py-1.5 bg-bg-2 border border-border-2 rounded-[7px] text-[12px] text-text outline-none focus:border-accent"
    >
      {(['7', '30', '90', '180', '365'] as ReportDays[]).map(d => (
        <option key={d} value={d}>Last {d} days</option>
      ))}
    </select>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-12 text-center text-[13px] text-text-3">{text}</div>
  )
}

// ── Tab: Inspection Summary ─────────────────────────────────────────────────

function InspectionSummaryTab() {
  const [days, setDays] = useState<ReportDays>('30')
  const { data = [], isLoading } = useInspectionSummary(days)

  const totalFindings = data.reduce((s, r) => s + parseInt(r.total_findings), 0)
  const totalPass     = data.reduce((s, r) => s + parseInt(r.pass_count), 0)
  const totalFail     = data.reduce((s, r) => s + parseInt(r.fail_count), 0)
  const passRate      = totalFindings > 0 ? Math.round((totalPass / totalFindings) * 100) : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          {[
            { label: 'Inspections', value: data.length,    color: 'bg-bg-2'       },
            { label: 'Findings',    value: totalFindings,  color: 'bg-bg-2'       },
            { label: 'Pass Rate',   value: `${passRate}%`, color: 'bg-success-bg' },
            { label: 'Failures',    value: totalFail,      color: 'bg-danger-bg'  },
          ].map(k => (
            <div key={k.label} className={`rounded-[8px] border border-border p-3 ${k.color}`}>
              <p className="text-[10px] text-text-2 uppercase tracking-[0.07em] mb-0.5">{k.label}</p>
              <p className="text-[22px] font-bold text-text leading-none">{isLoading ? '—' : k.value}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <DaysSelect value={days} onChange={setDays} />
          <Button variant="secondary" size="sm" onClick={() => downloadJson('inspection-summary', data)}>
            Export JSON
          </Button>
        </div>
      </div>

      <Card>
        {isLoading ? <SkeletonTable rows={6} /> : data.length === 0 ? (
          <EmptyState text="No completed inspections in this period." />
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-3">
              {['WO #', 'Asset', 'Inspector', 'Completed', 'WI', 'Pass', 'Fail', 'Result'].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1 first:w-20 first:flex-none">
                  {h}
                </span>
              ))}
            </div>
            {data.map((row: InspectionSummaryRow) => {
              const pass = parseInt(row.pass_count)
              const fail = parseInt(row.fail_count)
              return (
                <div key={row.wo_number} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 transition-colors">
                  <span className="font-mono text-[12px] text-accent w-20 flex-shrink-0">{row.wo_number}</span>
                  <span className="text-[13px] text-text flex-1 truncate">{row.asset_name}</span>
                  <span className="text-[12px] text-text-2 flex-1 truncate">{row.inspector_name ?? '—'}</span>
                  <span className="font-mono text-[11px] text-text-3 flex-1">{fmt(row.completed_at)}</span>
                  <span className="text-[11px] text-text-2 flex-1 truncate">{row.wi_number ?? '—'}</span>
                  <span className="font-mono text-[12px] text-success flex-1">{pass}</span>
                  <span className="font-mono text-[12px] text-danger flex-1">{fail}</span>
                  <span className="flex-1">
                    {row.overall_result
                      ? <Badge variant={row.overall_result === 'pass' ? 'active' : 'expired'}>{row.overall_result}</Badge>
                      : <span className="text-text-3 text-[11px]">—</span>}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </Card>
    </div>
  )
}

// ── Tab: WI Compliance ──────────────────────────────────────────────────────

function WIComplianceTab() {
  const { data = [], isLoading } = useWICompliance()

  const active   = data.filter(r => r.status === 'active').length
  const expiring = data.filter(r => r.status === 'expiring').length
  const expired  = data.filter(r => r.status === 'expired').length
  const draft    = data.filter(r => r.status === 'draft').length

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          {[
            { label: 'Active',   value: active,   color: 'bg-success-bg' },
            { label: 'Expiring', value: expiring, color: 'bg-warning-bg' },
            { label: 'Expired',  value: expired,  color: 'bg-danger-bg'  },
            { label: 'Draft',    value: draft,    color: 'bg-bg-2'       },
          ].map(k => (
            <div key={k.label} className={`rounded-[8px] border border-border p-3 ${k.color}`}>
              <p className="text-[10px] text-text-2 uppercase tracking-[0.07em] mb-0.5">{k.label}</p>
              <p className="text-[22px] font-bold text-text leading-none">{isLoading ? '—' : k.value}</p>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => downloadJson('wi-compliance', data)}>
          Export JSON
        </Button>
      </div>

      <Card>
        {isLoading ? <SkeletonTable rows={6} /> : data.length === 0 ? (
          <EmptyState text="No work instructions found." />
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-3">
              {['WI #', 'Title', 'Rev', 'Owner', 'Status', 'Expiry Date', 'Days Left'].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1 first:w-20 first:flex-none">
                  {h}
                </span>
              ))}
            </div>
            {data.map((row: WIComplianceRow) => {
              const days = row.days_remaining !== null ? parseInt(row.days_remaining) : null
              return (
                <div key={row.wi_number} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 transition-colors">
                  <span className="font-mono text-[12px] text-accent w-20 flex-shrink-0">{row.wi_number}</span>
                  <span className="text-[13px] text-text flex-1 truncate">{row.title}</span>
                  <span className="font-mono text-[11px] text-text-3 flex-1">{row.revision}</span>
                  <span className="text-[12px] text-text-2 flex-1 truncate">{row.owner_name ?? '—'}</span>
                  <span className="flex-1">
                    <Badge variant={STATUS_BADGE[row.status] ?? 'draft'}>{row.status}</Badge>
                  </span>
                  <span className="font-mono text-[11px] text-text-3 flex-1">{fmt(row.expiry_date)}</span>
                  <span className={`font-mono text-[12px] flex-1 ${
                    days === null   ? 'text-text-3' :
                    days < 0       ? 'text-danger'  :
                    days <= 30     ? 'text-warning'  : 'text-success'
                  }`}>
                    {days === null ? '—' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </Card>
    </div>
  )
}

// ── Tab: Defect Analysis ────────────────────────────────────────────────────

function DefectAnalysisTab() {
  const [days, setDays] = useState<ReportDays>('30')
  const { data = [], isLoading } = useDefectAnalysis(days)

  const totalFails = data.reduce((s, r) => s + parseInt(r.fail_count), 0)
  const maxFails   = data.length > 0 ? parseInt(data[0].fail_count) : 1

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[8px] border border-border p-3 bg-danger-bg">
            <p className="text-[10px] text-text-2 uppercase tracking-[0.07em] mb-0.5">Total Failures</p>
            <p className="text-[22px] font-bold text-text leading-none">{isLoading ? '—' : totalFails}</p>
          </div>
          <div className="rounded-[8px] border border-border p-3 bg-bg-2">
            <p className="text-[10px] text-text-2 uppercase tracking-[0.07em] mb-0.5">Unique Items</p>
            <p className="text-[22px] font-bold text-text leading-none">{isLoading ? '—' : data.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DaysSelect value={days} onChange={setDays} />
          <Button variant="secondary" size="sm" onClick={() => downloadJson('defect-analysis', data)}>
            Export JSON
          </Button>
        </div>
      </div>

      <Card>
        {isLoading ? <SkeletonTable rows={6} /> : data.length === 0 ? (
          <EmptyState text="No failures recorded in this period." />
        ) : (
          <CardBody className="p-0">
            {data.map((row: DefectAnalysisRow, i) => {
              const failCount = parseInt(row.fail_count)
              const barPct    = Math.round((failCount / maxFails) * 100)
              return (
                <div key={i} className="flex items-start gap-4 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 transition-colors">
                  <div className="flex-shrink-0 w-8 text-center">
                    <span className="text-[11px] font-bold text-danger">{failCount}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] text-text truncate">{row.item_description}</span>
                      <span className="text-[10px] text-text-3 bg-bg-3 border border-border rounded px-1.5 py-0.5 flex-shrink-0">{row.category}</span>
                    </div>
                    <div className="h-1.5 bg-bg-3 rounded-full overflow-hidden">
                      <div className="h-full bg-danger rounded-full" style={{ width: `${barPct}%` }} />
                    </div>
                    {row.sample_notes && (
                      <p className="text-[11px] text-text-3 mt-1 italic truncate">{row.sample_notes}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </CardBody>
        )}
      </Card>
    </div>
  )
}

// ── Tab: Audit Trail ────────────────────────────────────────────────────────

function AuditTrailTab() {
  const { data = [], isLoading } = useAuditLogs(200)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] text-text-2">Last 200 actions across all tables</p>
        <Button variant="secondary" size="sm" onClick={() => downloadJson('audit-trail', data)}>
          Export JSON
        </Button>
      </div>

      <Card>
        {isLoading ? <SkeletonTable rows={8} /> : data.length === 0 ? (
          <EmptyState text="No audit log entries found." />
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-3">
              {['Timestamp', 'Action', 'Table', 'Performed By'].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1">
                  {h}
                </span>
              ))}
            </div>
            {data.map((row: AuditLog) => (
              <div key={row.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 hover:bg-bg-3 transition-colors">
                <span className="font-mono text-[11px] text-text-3 flex-1">
                  {new Date(row.created_at).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`text-[12px] font-medium flex-1 ${
                  row.action === 'DELETE' ? 'text-danger' :
                  row.action === 'INSERT' ? 'text-success' : 'text-accent'
                }`}>{row.action}</span>
                <span className="font-mono text-[12px] text-text-2 flex-1">{row.table_name}</span>
                <span className="text-[12px] text-text-2 flex-1">{row.users?.name ?? row.performed_by ?? '—'}</span>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Reports() {
  const [activeTab, setActiveTab] = useState<Tab>('inspection-summary')

  return (
    <AppLayout breadcrumb={[{ label: 'Reports' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Reports</h1>
        <p className="text-[13px] text-text-2 mt-1">Generate and export inspection data</p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border mb-6">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer -mb-px ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-2 hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'inspection-summary' && <InspectionSummaryTab />}
      {activeTab === 'wi-compliance'      && <WIComplianceTab />}
      {activeTab === 'defect-analysis'    && <DefectAnalysisTab />}
      {activeTab === 'audit-trail'        && <AuditTrailTab />}
    </AppLayout>
  )
}
