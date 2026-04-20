import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import type { WorkInstruction, WIStatus } from '@/types'
import type { BadgeVariant } from '@/components/ui/Badge'

const STATUS_BADGE: Record<WIStatus, BadgeVariant> = {
  active: 'active', expiring: 'expiring', expired: 'expired',
  draft: 'draft', pending_approval: 'pending_approval', superseded: 'superseded',
}


export default function MasterLibrary() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: wis = [], isLoading } = useWorkInstructions(search || undefined)

  const active   = wis.filter(w => w.status === 'active').length
  const expiring = wis.filter(w => w.status === 'expiring').length
  const expired  = wis.filter(w => w.status === 'expired').length

  return (
    <AppLayout breadcrumb={[{ label: 'Master Library' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Master Library</h1>
          <p className="text-[13px] text-text-2 mt-1">Work instruction repository and revision control</p>
        </div>
        <Button variant="primary" onClick={() => navigate('/library/new')}>+ New WI</Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total',    value: wis.length, color: 'bg-bg-2'        },
          { label: 'Active',   value: active,     color: 'bg-success-bg'  },
          { label: 'Expiring', value: expiring,   color: 'bg-warning-bg'  },
          { label: 'Expired',  value: expired,    color: 'bg-danger-bg'   },
        ].map(k => (
          <div key={k.label} className={`rounded-[10px] border border-border p-4 ${k.color}`}>
            <p className="text-[11px] text-text-2 uppercase tracking-[0.07em] mb-1">{k.label}</p>
            <p className="text-[26px] font-bold text-text leading-none">{isLoading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title or WI number…"
          className="w-full max-w-sm px-[14px] py-[9px] bg-bg-2 border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors"
        />
      </div>

      {/* Table */}
      <Card>
        {isLoading ? (
          <SkeletonTable rows={6} />
        ) : wis.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-text-3 text-center py-8">
              {search ? `No results for "${search}"` : 'No work instructions yet.'}
            </p>
          </CardBody>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-3">
              {['WI #', 'Title', 'Rev', 'Owner', 'Status', 'Expires In', 'Expiry Date'].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1 first:w-24 first:flex-none">
                  {h}
                </span>
              ))}
            </div>
            {wis.map((wi: WorkInstruction) => (
              <div key={wi.dbId}
                onClick={() => navigate(`/library/${wi.dbId}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 cursor-pointer transition-colors group">
                <span className="font-mono text-[12px] text-accent w-24 flex-shrink-0">{wi.id}</span>
                <span className="text-[13px] text-text flex-1 truncate group-hover:text-accent transition-colors">{wi.title}</span>
                <span className="font-mono text-[11px] text-text-3 flex-1">{wi.revision}</span>
                <span className="text-[12px] text-text-2 flex-1 truncate hidden md:block">{wi.owner}</span>
                <span className="flex-1">
                  <Badge variant={STATUS_BADGE[wi.status] ?? 'draft'}>{wi.status}</Badge>
                </span>
                <span className={`font-mono text-[12px] flex-1 ${
                  wi.daysRemaining < 0 ? 'text-danger' :
                  wi.daysRemaining <= 30 ? 'text-warning' : 'text-success'
                }`}>
                  {!wi.expiryDate ? '—' :
                   wi.daysRemaining < 0 ? `${Math.abs(wi.daysRemaining)}d ago` :
                   `${wi.daysRemaining}d`}
                </span>
                <span className="font-mono text-[11px] text-text-3 flex-1 hidden lg:block">{wi.expiryDate || '—'}</span>
                <button
                  onClick={e => { e.stopPropagation(); navigate(`/library/${wi.dbId}/edit`) }}
                  className="flex items-center gap-1 text-[11px] text-text-3 hover:text-accent bg-transparent border border-border hover:border-accent rounded-[6px] px-2 py-1 cursor-pointer transition-all opacity-0 group-hover:opacity-100 flex-shrink-0">
                  <Pencil size={11} /> Edit
                </button>
              </div>
            ))}
          </>
        )}
      </Card>

    </AppLayout>
  )
}
