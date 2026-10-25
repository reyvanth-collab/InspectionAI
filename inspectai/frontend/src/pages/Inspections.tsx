import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertCircle, CheckCircle2, ClipboardList, ListChecks, Plus, Search, TimerReset } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { MetricTile, PageHero } from '@/components/ui/PageHero'
import { useWorkOrders, useCreateWorkOrder } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useAssets } from '@/hooks/useAssets'
import { useUsers } from '@/hooks/useUsers'
import { useToast } from '@/components/ui/Toast'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_BADGE: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'cancelled': 'pending',
}
const PRIORITY_BADGE: Record<WOPriority, 'high' | 'medium' | 'low'> = {
  high: 'high', medium: 'medium', low: 'low', critical: 'high',
}

type FilterStatus = WOStatus | 'all'

const INPUT  = 'w-full px-3 py-2 bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'
const LABEL  = 'block text-[11px] font-medium text-text-2 uppercase tracking-[0.07em] mb-1'

export default function Inspections() {
  const navigate      = useNavigate()
  const { toast }     = useToast()
  const [filter, setFilter]     = useState<FilterStatus>('all')
  const [showModal, setShowModal] = useState(false)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({
    woNumber: '', asset: '', location: '', wi: '', inspector: '', dueDate: '',
  })
  const [assetSearch, setAssetSearch] = useState('')
  const [wiSearch, setWiSearch] = useState('')

  const { data: woPage, isLoading } = useWorkOrders(undefined, page, search, columnFilters)
  const wos = woPage?.items ?? []
  const { data: wis  = [] }            = useWorkInstructions(wiSearch)
  const { data: users = [] }           = useUsers()
  const { data: assetPage }            = useAssets({ search: assetSearch, page: 1 })
  const assets = assetPage?.items ?? []
  const createWO                       = useCreateWorkOrder()
  const usableWis = wis.filter(w => (w.checkableItemCount ?? w.checklistItemCount ?? 0) > 0)

  useEffect(() => { setPage(1) }, [filter, search, columnFilters])

  const filtered = filter === 'all' ? wos : wos.filter(w => w.status === filter)

  const open       = wos.filter(w => w.status === 'open').length
  const inProgress = wos.filter(w => w.status === 'in-progress').length
  const complete   = wos.filter(w => w.status === 'complete').length

  const [form, setForm] = useState({
    assetId: '', priority: 'medium',
    dueDate: '', assignedTo: '', workInstructionId: '', notes: '',
  })
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))
  const setColumnFilter = (key: keyof typeof columnFilters) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setColumnFilters(prev => ({ ...prev, [key]: e.target.value }))

  const handleCreate = async () => {
    if (!form.assetId) { toast('Select an asset', 'error'); return }
    if (!form.workInstructionId) { toast('Attach a work instruction checklist first', 'error'); return }
    const selectedWI = usableWis.find(w => w.dbId === form.workInstructionId)
    if (!selectedWI) { toast('Selected work instruction has no checklist items', 'error'); return }
    try {
      const created = await createWO.mutateAsync({
        assetId: form.assetId,
        priority: form.priority, dueDate: form.dueDate,
        assignedTo: form.assignedTo, workInstructionId: form.workInstructionId,
        notes: form.notes || undefined,
      })
      toast('Work order created', 'success')
      setShowModal(false)
      setForm({ assetId: '', priority: 'medium', dueDate: '', assignedTo: '', workInstructionId: '', notes: '' })
      const createdId = typeof created.id === 'string' ? created.id : ''
      if (createdId) navigate(`/inspections/${createdId}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create', 'error')
    }
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Inspections' }]}>
      <PageHero
        eyebrow="Inspection Operations"
        title="Plan, launch, and close field inspections with controlled checklist coverage."
        description="A live work-order command board for assets, assigned inspectors, WI readiness, due dates, and execution status."
        icon={ClipboardList}
        stats={[
          { label: 'Open', value: isLoading ? '-' : open, tone: 'warning' },
          { label: 'In progress', value: isLoading ? '-' : inProgress, tone: 'accent' },
          { label: 'Complete', value: isLoading ? '-' : complete, tone: 'success' },
          { label: 'Visible', value: isLoading ? '-' : filtered.length, tone: 'info' },
        ]}
        actions={
          <Button variant="primary" onClick={() => { setAssetSearch(''); setWiSearch(''); setShowModal(true) }}>
            <Plus size={15} /> New Work Order
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <MetricTile label="Total Queue" value={isLoading ? '-' : wos.length} sub="Loaded work orders" icon={ListChecks} tone="info" />
        <MetricTile label="Open" value={isLoading ? '-' : open} sub="Waiting to start" icon={TimerReset} tone="warning" />
        <MetricTile label="In Progress" value={isLoading ? '-' : inProgress} sub="Currently executing" icon={Activity} tone="accent" />
        <MetricTile label="Complete" value={isLoading ? '-' : complete} sub="Inspection closed" icon={CheckCircle2} tone="success" />
      </div>

      {/* KPI row */}
      <div className="hidden">
        {[
          { label: 'Total',       value: wos.length, color: 'bg-bg-2' },
          { label: 'Open',        value: open,        color: 'bg-warning-bg' },
          { label: 'In Progress', value: inProgress,  color: 'bg-accent-bg'  },
          { label: 'Complete',    value: complete,    color: 'bg-success-bg' },
        ].map(k => (
          <div key={k.label} className={`rounded-[10px] border border-border p-4 ${k.color}`}>
            <p className="text-[11px] text-text-2 uppercase tracking-[0.07em] mb-1">{k.label}</p>
            <p className="text-[26px] font-bold text-text leading-none">{isLoading ? '—' : k.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 flex-wrap">
          {(['all', 'open', 'in-progress', 'complete'] as FilterStatus[]).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all cursor-pointer ${
                filter === s
                  ? 'bg-accent-bg border-accent-bd text-accent'
                  : 'bg-transparent border-border-2 text-text-2 hover:border-accent hover:text-accent'
              }`}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="relative w-full lg:w-[360px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search WO, asset, WI, location, inspector..."
            className={INPUT + ' pl-9'}
          />
        </div>
      </div>

      {/* Table */}
      <Card className="premium-ring">
        {isLoading ? (
          <SkeletonTable rows={6} />
        ) : filtered.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-text-3 text-center py-8">
              No work orders {filter !== 'all' ? `with status "${filter}"` : 'found'}.
            </p>
          </CardBody>
        ) : (
          <>
            {/* Header row */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-3">
              {['WO #', 'Asset', 'Location', 'WI Ref', 'Priority', 'Status', 'Inspector', 'Due Date'].map(h => (
                <span key={h} className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.07em] flex-1 first:w-20 first:flex-none last:w-24 last:flex-none">
                  {h}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-2">
              <input value={columnFilters.woNumber} onChange={setColumnFilter('woNumber')} placeholder="WO" className="w-20 flex-none rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent" />
              <input value={columnFilters.asset} onChange={setColumnFilter('asset')} placeholder="Asset" className="min-w-0 flex-1 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent" />
              <input value={columnFilters.location} onChange={setColumnFilter('location')} placeholder="Location" className="hidden min-w-0 flex-1 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent md:block" />
              <input value={columnFilters.wi} onChange={setColumnFilter('wi')} placeholder="WI" className="hidden min-w-0 flex-1 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent lg:block" />
              <span className="flex-1" />
              <span className="flex-1" />
              <input value={columnFilters.inspector} onChange={setColumnFilter('inspector')} placeholder="Inspector" className="hidden min-w-0 flex-1 rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent md:block" />
              <input type="date" value={columnFilters.dueDate} onChange={setColumnFilter('dueDate')} className="w-24 flex-none rounded-[6px] border border-border bg-bg px-2 py-1.5 text-[11px] text-text outline-none focus:border-accent" />
            </div>
            {filtered.map((wo: WorkOrder) => (
              <div key={wo.dbId}
                onClick={() => navigate(`/inspections/${wo.dbId}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 cursor-pointer transition-colors group">
                <span className="font-mono text-[12px] text-accent w-20 flex-shrink-0">{wo.id}</span>
                <span className="text-[13px] text-text flex-1 truncate group-hover:text-accent transition-colors">{wo.asset}</span>
                <span className="text-[12px] text-text-2 flex-1 truncate hidden md:block">{wo.location}</span>
                <span className="font-mono text-[11px] text-text-3 flex-1 hidden lg:block">
                  {wo.wiRef === '-' || (wo.checklistItemCount ?? 0) < 1 ? (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertCircle size={12} /> Missing checklist
                    </span>
                  ) : wo.wiRef}
                </span>
                <span className="flex-1"><Badge variant={PRIORITY_BADGE[wo.priority]}>{wo.priority}</Badge></span>
                <span className="flex-1"><Badge variant={STATUS_BADGE[wo.status]}>{wo.status}</Badge></span>
                <span className="text-[12px] text-text-2 flex-1 hidden md:block truncate">{wo.assignedTo}</span>
                <span className="font-mono text-[11px] text-text-3 w-24 flex-shrink-0 text-right">{wo.dueDate || '—'}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-[11px] text-text-3">Page {page}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={!woPage?.hasMore} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Create Work Order modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="New Work Order"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button variant="primary" loading={createWO.isPending} disabled={usableWis.length === 0} onClick={handleCreate}>
              Create Work Order
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={LABEL}>Asset <span className="text-danger">*</span></label>
              <SearchInput
                value={assetSearch}
                onChange={setAssetSearch}
                placeholder="Search by asset number, name, or location..."
              />
              <select value={form.assetId} onChange={set('assetId')} className={INPUT} required>
                <option value="" disabled>Select registered asset...</option>
                {assets.map(asset => (
                  <option key={asset.id} value={asset.id}>{asset.assetNumber} — {asset.name}{asset.location ? ` (${asset.location})` : ''}</option>
                ))}
              </select>
              {assets.length === 0 && (
                <p className="text-[11px] text-warning mt-1">No matching assets found.</p>
              )}
            </div>
            <div>
              <label className={LABEL}>Location</label>
              <input value={assets.find(asset => asset.id === form.assetId)?.location ?? ''} readOnly placeholder="Selected asset location" className={INPUT + ' opacity-70'} />
            </div>
            <div>
              <label className={LABEL}>Priority</label>
              <select value={form.priority} onChange={set('priority')} className={INPUT}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Due Date</label>
              <input type="date" value={form.dueDate} onChange={set('dueDate')} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Assign Inspector</label>
              <select value={form.assignedTo} onChange={set('assignedTo')} className={INPUT}>
                <option value="">— Unassigned —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Work Instruction Checklist <span className="text-danger">*</span></label>
              <SearchInput
                value={wiSearch}
                onChange={setWiSearch}
                placeholder="Search by WI number or title..."
              />
              <select value={form.workInstructionId} onChange={set('workInstructionId')} required className={INPUT}>
                <option value="" disabled>Select checklist...</option>
                {wis.map(w => {
                  const count = w.checkableItemCount ?? w.checklistItemCount ?? 0
                  return (
                    <option key={w.dbId} value={w.dbId} disabled={count < 1}>
                      {w.id} - {w.title} ({count} item{count === 1 ? '' : 's'})
                    </option>
                  )
                })}
                {/*
                  <option key={w.dbId} value={w.dbId}>{w.id} — {w.title}</option>
                */}
              </select>
              {wis.length === 0 && (
                <p className="text-[11px] text-warning mt-1">No matching work instructions found.</p>
              )}
              {usableWis.length === 0 ? (
                <div className="mt-2 flex items-start gap-2 rounded-[8px] border border-warning-border bg-warning-bg/20 px-3 py-2 text-warning">
                  <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[12px] leading-relaxed">
                    Create or publish a work instruction with checklist items before opening work orders.
                  </p>
                </div>
              ) : form.workInstructionId ? (
                <div className="mt-2 flex items-center gap-2 text-[12px] text-text-3">
                  <ClipboardList size={14} />
                  <span>
                    {usableWis.find(w => w.dbId === form.workInstructionId)?.checkableItemCount ?? 0} checklist items will be attached.
                  </span>
                </div>
              ) : null}
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Notes</label>
              <textarea value={form.notes} onChange={set('notes')} rows={2}
                placeholder="Optional notes…" className={INPUT + ' resize-none'} />
            </div>
          </div>
        </div>
      </Modal>
    </AppLayout>
  )
}

function SearchInput({ value, onChange, placeholder }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative mb-2">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={INPUT + ' pl-9'}
      />
    </div>
  )
}
