import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader } from '@/components/ui/Card'
import { useAuditLogs, type AuditLog } from '@/hooks/useAuditLogs'
import { Button } from '@/components/ui/Button'

const TABLE_OPTIONS = ['', 'work_instructions', 'inspection_records', 'approval_records', 'approval_steps', 'users']
const TABLE_LABELS: Record<string, string> = {
  '':                   'All tables',
  work_instructions:    'Work Instructions',
  inspection_records:   'Inspections',
  approval_records:     'Approvals',
  approval_steps:       'Approval Steps',
  users:                'Users',
}

const ACTION_COLOR: Record<string, string> = {
  INSERT: 'text-success bg-success-bg border-success-border',
  UPDATE: 'text-warning bg-warning-bg border-warning-border',
  DELETE: 'text-danger  bg-danger-bg  border-danger-border',
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 1)   return 'just now'
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-SG')
}

const PAGE_SIZE = 50

export default function AuditTrail() {
  const [tableFilter, setTableFilter] = useState('')
  const [limit, setLimit]             = useState(PAGE_SIZE)

  const { data: logs = [], isLoading } = useAuditLogs(limit, tableFilter || undefined)

  const canLoadMore = logs.length === limit

  return (
    <AppLayout breadcrumb={[{ label: 'Audit Trail' }]}>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Audit Trail</h1>
          <p className="text-[13px] text-text-2 mt-1">System-wide event log for all data changes</p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-text-3 uppercase tracking-[0.07em]">Table</label>
          <select
            value={tableFilter}
            onChange={e => { setTableFilter(e.target.value); setLimit(PAGE_SIZE) }}
            className="px-3 py-1.5 bg-bg-2 border border-border-2 rounded-[6px] text-[12px] text-text outline-none focus:border-accent appearance-none cursor-pointer"
          >
            {TABLE_OPTIONS.map(t => (
              <option key={t} value={t}>{TABLE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader actions={
          <span className="text-[11px] text-text-3 font-mono">{logs.length} events</span>
        }>
          Events
        </CardHeader>

        {isLoading ? (
          <div className="flex flex-col gap-0">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex items-center gap-4 px-[18px] py-3 border-b border-border last:border-0">
                <div className="w-14 h-5 rounded shimmer" />
                <div className="w-32 h-5 rounded shimmer" />
                <div className="flex-1 h-5 rounded shimmer" />
                <div className="w-20 h-4 rounded shimmer" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="px-[18px] py-12 text-center text-[13px] text-text-3">
            No audit events found.
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="flex items-center gap-4 px-[18px] py-2 border-b border-border bg-bg-3/40">
              <span className="w-14 text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">Action</span>
              <span className="w-36 text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">Table</span>
              <span className="flex-1 text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">Performed by</span>
              <span className="w-24 text-right text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em]">When</span>
            </div>

            {logs.map((log: AuditLog) => (
              <div
                key={log.id}
                className="flex items-center gap-4 px-[18px] py-3 border-b border-border last:border-0 hover:bg-bg-3/30 transition-colors"
              >
                <span className={`w-14 text-center text-[10px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide flex-shrink-0 ${
                  ACTION_COLOR[log.action] ?? 'text-text-2 bg-bg-3 border-border-2'
                }`}>
                  {log.action}
                </span>

                <span className="w-36 text-[12px] font-mono text-text-2 truncate flex-shrink-0">
                  {TABLE_LABELS[log.table_name] ?? log.table_name}
                </span>

                <span className="flex-1 text-[13px] text-text truncate">
                  {log.performed_by_name ?? '—'}
                </span>

                <span
                  title={new Date(log.created_at).toLocaleString('en-SG')}
                  className="w-24 text-right text-[11px] text-text-3 font-mono flex-shrink-0"
                >
                  {relativeTime(log.created_at)}
                </span>
              </div>
            ))}

            {canLoadMore && (
              <div className="flex justify-center px-[18px] py-4 border-t border-border">
                <Button variant="secondary" onClick={() => setLimit(l => l + PAGE_SIZE)}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </AppLayout>
  )
}
