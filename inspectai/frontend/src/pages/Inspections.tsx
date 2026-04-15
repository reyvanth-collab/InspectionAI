import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useWorkOrders } from '@/hooks/useWorkOrders'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_MAP: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'pending': 'pending',
}
const PRIORITY_MAP: Record<WOPriority, 'high' | 'medium' | 'low'> = {
  high: 'high', medium: 'medium', low: 'low', critical: 'high',
}

type FilterStatus = WOStatus | 'all'

const columns = [
  { key: 'id',         header: 'WO #',      render: (r: WorkOrder) => <span className="font-mono text-[12px] text-accent">{r.id}</span> },
  { key: 'asset',      header: 'Asset' },
  { key: 'wiRef',      header: 'WI Ref',    render: (r: WorkOrder) => <span className="font-mono text-[11px] text-text-3">{r.wiRef}</span> },
  { key: 'type',       header: 'Type' },
  { key: 'priority',   header: 'Priority',  render: (r: WorkOrder) => <Badge variant={PRIORITY_MAP[r.priority]}>{r.priority}</Badge> },
  { key: 'status',     header: 'Status',    render: (r: WorkOrder) => <Badge variant={STATUS_MAP[r.status]}>{r.status}</Badge> },
  { key: 'assignedTo', header: 'Inspector' },
  { key: 'dueDate',    header: 'Due',       render: (r: WorkOrder) => <span className="font-mono text-[12px] text-text-2">{r.dueDate}</span> },
]

export default function Inspections() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterStatus>('all')
  const { data: wos = [], isLoading } = useWorkOrders()

  const filtered = filter === 'all' ? wos : wos.filter(w => w.status === filter)

  return (
    <AppLayout breadcrumb={[{ label: 'Inspections' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Inspections</h1>
          <p className="text-[13px] text-text-2 mt-1">Manage and execute work order inspections</p>
        </div>
        <Button variant="primary">+ New Inspection</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total"       value={wos.length} />
        <StatCard label="Open"        value={wos.filter(w => w.status === 'open').length}        color="amber"  />
        <StatCard label="In Progress" value={wos.filter(w => w.status === 'in-progress').length} color="accent" />
        <StatCard label="Complete"    value={wos.filter(w => w.status === 'complete').length}    color="green"  />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'open', 'in-progress', 'pending', 'complete'] as FilterStatus[]).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all ${
              filter === s
                ? 'bg-accent-bg border-accent-bd text-accent'
                : 'bg-transparent border-border-2 text-text-2 hover:border-accent hover:text-accent'
            }`}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-[8px] shimmer" />)}
        </div>
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          onRowClick={row => navigate(`/inspections/${row.dbId}`)}
          emptyMessage="No work orders match this filter"
        />
      )}
    </AppLayout>
  )
}
