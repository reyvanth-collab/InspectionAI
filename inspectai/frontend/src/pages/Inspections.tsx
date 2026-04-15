import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { Modal } from '@/components/ui/Modal'
import { useWorkOrders, useCreateWorkOrder } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import { useUsers } from '@/hooks/useUsers'
import { useToast } from '@/components/ui/Toast'
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
  { key: 'location',   header: 'Location' },
  { key: 'wiRef',      header: 'WI Ref',    render: (r: WorkOrder) => <span className="font-mono text-[11px] text-text-3">{r.wiRef}</span> },
  { key: 'priority',   header: 'Priority',  render: (r: WorkOrder) => <Badge variant={PRIORITY_MAP[r.priority]}>{r.priority}</Badge> },
  { key: 'status',     header: 'Status',    render: (r: WorkOrder) => <Badge variant={STATUS_MAP[r.status]}>{r.status}</Badge> },
  { key: 'assignedTo', header: 'Inspector' },
  { key: 'dueDate',    header: 'Due',       render: (r: WorkOrder) => <span className="font-mono text-[12px] text-text-2">{r.dueDate}</span> },
]

const INPUT_CLS = 'w-full px-[14px] py-[9px] bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'
const LABEL_CLS = 'block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5'

export default function Inspections() {
  const navigate       = useNavigate()
  const { toast }      = useToast()
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [showModal, setShowModal] = useState(false)

  const { data: wos = [], isLoading } = useWorkOrders()
  const { data: wis = [] }            = useWorkInstructions()
  const { data: users = [] }          = useUsers()
  const createWO                      = useCreateWorkOrder()

  const filtered = filter === 'all' ? wos : wos.filter(w => w.status === filter)

  // Form state
  const [form, setForm] = useState({
    assetName: '', location: '', priority: 'medium',
    dueDate: '', assignedTo: '', workInstructionId: '', notes: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  const handleCreate = async () => {
    if (!form.assetName.trim()) { toast('Asset name is required', 'error'); return }
    try {
      await createWO.mutateAsync({
        assetName:          form.assetName,
        location:           form.location,
        priority:           form.priority,
        dueDate:            form.dueDate,
        assignedTo:         form.assignedTo,
        workInstructionId:  form.workInstructionId || undefined,
        notes:              form.notes || undefined,
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
            className={`px-3 py-1.5 rounded-[6px] text-[12px] border transition-all cursor-pointer ${
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
              <label className={LABEL_CLS}>Asset Name <span className="text-danger">*</span></label>
              <input value={form.assetName} onChange={set('assetName')} placeholder="e.g. Escalator E-01" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Location</label>
              <input value={form.location} onChange={set('location')} placeholder="e.g. Bishan MRT" className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Priority</label>
              <select value={form.priority} onChange={set('priority')} className={INPUT_CLS}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Due Date</label>
              <input type="date" value={form.dueDate} onChange={set('dueDate')} className={INPUT_CLS} />
            </div>
            <div>
              <label className={LABEL_CLS}>Assign Inspector</label>
              <select value={form.assignedTo} onChange={set('assignedTo')} className={INPUT_CLS}>
                <option value="">— Unassigned —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={LABEL_CLS}>Work Instruction</label>
              <select value={form.workInstructionId} onChange={set('workInstructionId')} className={INPUT_CLS}>
                <option value="">— No WI linked —</option>
                {wis.map(w => (
                  <option key={w.dbId} value={w.dbId}>{w.id} — {w.title}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className={LABEL_CLS}>Notes</label>
              <textarea value={form.notes} onChange={set('notes')} rows={2} placeholder="Optional notes…"
                className={INPUT_CLS + ' resize-none'} />
            </div>
          </div>
        </div>
      </Modal>
    </AppLayout>
  )
}
