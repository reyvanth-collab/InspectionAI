import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { useWorkOrders, useCreateWorkOrder } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useUsers } from '@/hooks/useUsers'
import { useToast } from '@/components/ui/Toast'
import type { WorkOrder, WOStatus, WOPriority } from '@/types'

const STATUS_BADGE: Record<WOStatus, 'open' | 'complete' | 'pending' | 'expiring'> = {
  'open': 'open', 'in-progress': 'expiring', 'complete': 'complete', 'pending': 'pending',
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

  const { data: wos  = [], isLoading } = useWorkOrders()
  const { data: wis  = [] }            = useWorkInstructions()
  const { data: users = [] }           = useUsers()
  const createWO                       = useCreateWorkOrder()

  const filtered = filter === 'all' ? wos : wos.filter(w => w.status === filter)

  const open       = wos.filter(w => w.status === 'open').length
  const inProgress = wos.filter(w => w.status === 'in-progress').length
  const complete   = wos.filter(w => w.status === 'complete').length

  const [form, setForm] = useState({
    assetName: '', location: '', priority: 'medium',
    dueDate: '', assignedTo: '', workInstructionId: '', notes: '',
  })
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }))

  const handleCreate = async () => {
    if (!form.assetName.trim()) { toast('Asset name is required', 'error'); return }
    try {
      await createWO.mutateAsync({
        assetName: form.assetName, location: form.location,
        priority: form.priority, dueDate: form.dueDate,
        assignedTo: form.assignedTo, workInstructionId: form.workInstructionId || undefined,
        notes: form.notes || undefined,
      })
      toast('Work order created', 'success')
      setShowModal(false)
      setForm({ assetName: '', location: '', priority: 'medium', dueDate: '', assignedTo: '', workInstructionId: '', notes: '' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create', 'error')
    }
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Inspections' }]}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Inspections</h1>
          <p className="text-[13px] text-text-2 mt-1">Manage and execute work order inspections</p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>+ New Work Order</Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
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
      <div className="flex gap-2 mb-4 flex-wrap">
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

      {/* Table */}
      <Card>
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
            {filtered.map((wo: WorkOrder) => (
              <div key={wo.dbId}
                onClick={() => navigate(`/inspections/${wo.dbId}`)}
                className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-bg-3 cursor-pointer transition-colors group">
                <span className="font-mono text-[12px] text-accent w-20 flex-shrink-0">{wo.id}</span>
                <span className="text-[13px] text-text flex-1 truncate group-hover:text-accent transition-colors">{wo.asset}</span>
                <span className="text-[12px] text-text-2 flex-1 truncate hidden md:block">{wo.location}</span>
                <span className="font-mono text-[11px] text-text-3 flex-1 hidden lg:block">{wo.wiRef}</span>
                <span className="flex-1"><Badge variant={PRIORITY_BADGE[wo.priority]}>{wo.priority}</Badge></span>
                <span className="flex-1"><Badge variant={STATUS_BADGE[wo.status]}>{wo.status}</Badge></span>
                <span className="text-[12px] text-text-2 flex-1 hidden md:block truncate">{wo.assignedTo}</span>
                <span className="font-mono text-[11px] text-text-3 w-24 flex-shrink-0 text-right">{wo.dueDate || '—'}</span>
              </div>
            ))}
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
            <Button variant="primary" loading={createWO.isPending} onClick={handleCreate}>
              Create Work Order
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={LABEL}>Asset Name <span className="text-danger">*</span></label>
              <input value={form.assetName} onChange={set('assetName')} placeholder="e.g. Escalator E-01" className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Location</label>
              <input value={form.location} onChange={set('location')} placeholder="e.g. Bishan MRT" className={INPUT} />
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
              <label className={LABEL}>Work Instruction</label>
              <select value={form.workInstructionId} onChange={set('workInstructionId')} className={INPUT}>
                <option value="">— No WI linked —</option>
                {wis.map(w => (
                  <option key={w.dbId} value={w.dbId}>{w.id} — {w.title}</option>
                ))}
              </select>
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
