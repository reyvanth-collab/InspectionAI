import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import type { WorkInstruction, WIStatus } from '@/types'

const STATUS_MAP: Record<WIStatus, 'active' | 'expiring' | 'expired' | 'draft'> = {
  active: 'active', expiring: 'expiring', expired: 'expired', draft: 'draft',
  pending_approval: 'pending' as unknown as 'draft', superseded: 'draft',
}

const columns = [
  { key: 'id',           header: 'WI #',     render: (r: WorkInstruction) => <span className="font-mono text-[12px] text-accent">{r.id}</span> },
  { key: 'title',        header: 'Title' },
  { key: 'revision',     header: 'Rev',      render: (r: WorkInstruction) => <span className="font-mono text-[11px] text-text-3">{r.revision}</span> },
  { key: 'owner',        header: 'Owner' },
  { key: 'status',       header: 'Status',   render: (r: WorkInstruction) => <Badge variant={STATUS_MAP[r.status] ?? 'draft'}>{r.status}</Badge> },
  {
    key: 'daysRemaining', header: 'Expires In',
    render: (r: WorkInstruction) => {
      if (!r.expiryDate)           return <span className="text-text-3 text-[12px]">—</span>
      if (r.daysRemaining < 0)    return <span className="text-danger  font-mono text-[12px]">{Math.abs(r.daysRemaining)}d ago</span>
      if (r.daysRemaining <= 30)  return <span className="text-warning font-mono text-[12px]">{r.daysRemaining}d</span>
      return <span className="text-success font-mono text-[12px]">{r.daysRemaining}d</span>
    },
  },
  { key: 'expiryDate',   header: 'Expiry',   render: (r: WorkInstruction) => <span className="font-mono text-[11px] text-text-3">{r.expiryDate || '—'}</span> },
]

export default function MasterLibrary() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data: wis = [], isLoading } = useWorkInstructions(search || undefined)

  return (
    <AppLayout breadcrumb={[{ label: 'Master Library' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Master Library</h1>
          <p className="text-[13px] text-text-2 mt-1">Work instruction repository and revision control</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">↑ Upload PDF</Button>
          <Button variant="primary">+ New WI</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total"    value={wis.length} />
        <StatCard label="Active"   value={wis.filter(w => w.status === 'active').length}   color="green" />
        <StatCard label="Expiring" value={wis.filter(w => w.status === 'expiring').length} color="amber" />
        <StatCard label="Expired"  value={wis.filter(w => w.status === 'expired').length}  color="red"   />
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title or WI number…"
          className="w-full max-w-sm px-[14px] py-[9px] bg-bg-2 border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-[8px] shimmer" />)}
        </div>
      ) : (
        <Table
          columns={columns}
          rows={wis}
          onRowClick={row => navigate(`/library/${row.dbId}`)}
          emptyMessage="No work instructions found"
        />
      )}
    </AppLayout>
  )
}
