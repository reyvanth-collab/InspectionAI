import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Clock3, Search, SlidersHorizontal, X } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { Modal } from '@/components/ui/Modal'
import { SkeletonTable } from '@/components/ui/Skeleton'
import { useApprovals, useApproveStep, useRejectStep, type Approval, type ApprovalStep } from '@/hooks/useApprovals'

type Filter = 'all' | 'active' | 'done' | 'rejected'
type SortKey = 'submitted_at' | 'wi_number' | 'final_status'

const PAGE_SIZE = 25

const STATUS_META: Record<string, { label: string; variant: BadgeVariant; dot: string }> = {
  active: { label: 'Pending review', variant: 'pending', dot: 'bg-warning' },
  done: { label: 'Approved', variant: 'approved', dot: 'bg-success' },
  rejected: { label: 'Rejected', variant: 'rejected', dot: 'bg-danger' },
}

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, variant: 'draft' as BadgeVariant, dot: 'bg-text-3' }
}

function StepTimeline({ steps }: { steps: ApprovalStep[] }) {
  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative grid min-w-[560px] items-start" style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, 1)}, minmax(0, 1fr))` }}>
        <div className="absolute left-[8%] right-[8%] top-4 h-0.5 bg-border-2" />
        <div className="absolute left-[8%] top-4 h-0.5 bg-success" style={{ width: steps.length > 1 ? `${Math.min(84, (Math.max(0, steps.filter(step => step.status === 'done').length - 1) / (steps.length - 1)) * 84)}%` : '0%' }} />
        {steps.map((step) => {
        const done = step.status === 'done'
        const rejected = step.status === 'rejected'
        return (
          <div key={step.id} className="relative z-10 flex min-w-0 flex-col items-center text-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-semibold ${
                done ? 'border-success bg-success-bg text-success' :
                rejected ? 'border-danger bg-danger-bg text-danger' :
                step.status === 'active' ? 'border-accent bg-accent-bg text-accent' :
                'border-border-2 bg-bg-3 text-text-3'
              }`}>
                {done ? <Check size={14} /> : rejected ? <X size={14} /> : step.step_number}
              </div>
              <p className={`mt-2 text-[11px] font-medium ${done ? 'text-success' : step.status === 'active' ? 'text-accent' : 'text-text-2'}`}>
                {step.label ?? `Step ${step.step_number}`}
              </p>
              <p className="mt-0.5 truncate max-w-full px-2 text-[10px] text-text-3">{step.approver_name ?? 'Unassigned'}</p>
            </div>
        )
        })}
      </div>
    </div>
  )
}

function ApprovalDetail({ approval, onAction }: { approval: Approval; onAction: (type: 'approve' | 'reject', stepId: string) => void }) {
  const steps = [...(approval.approval_steps ?? [])].sort((a, b) => a.step_number - b.step_number)
  const activeStep = steps.find(step => step.status === 'active')
  const meta = statusMeta(approval.final_status)

  return (
    <div className="border-t border-border bg-bg-3 px-4 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] text-text-3">Approval workflow</p>
          <p className="mt-1 text-[12px] text-text-2">
            Submitted by <span className="text-text">{approval.submitted_by_name ?? 'Unknown'}</span> on {new Date(approval.submitted_at).toLocaleDateString('en-SG')}
          </p>
        </div>
        {activeStep && (
          <div className="flex gap-2">
            <Button variant="danger" size="sm" onClick={() => onAction('reject', activeStep.id)}>Reject</Button>
            <Button variant="success" size="sm" onClick={() => onAction('approve', activeStep.id)}>Approve step</Button>
          </div>
        )}
      </div>
      <StepTimeline steps={steps} />
      {steps.filter(step => step.comment).length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {steps.filter(step => step.comment).map(step => (
            <div key={step.id} className="rounded-md border border-border bg-bg-2 px-3 py-2 text-[12px]">
              <span className="text-text-2">{step.label ?? 'Review'}:</span> <span className="text-text">{step.comment}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2 text-[11px] text-text-3">
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        {meta.label} · {steps.length} workflow {steps.length === 1 ? 'step' : 'steps'}
      </div>
    </div>
  )
}

export default function Approvals() {
  const { data: approvals = [], isLoading } = useApprovals()
  const approveStep = useApproveStep()
  const rejectStep = useRejectStep()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('submitted_at')
  const [ascending, setAscending] = useState(false)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modal, setModal] = useState<{ type: 'approve' | 'reject'; stepId: string } | null>(null)
  const [comment, setComment] = useState('')

  const pending = approvals.filter(a => a.final_status === 'active').length
  const approved = approvals.filter(a => a.final_status === 'done').length
  const rejected = approvals.filter(a => a.final_status === 'rejected').length

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return approvals
      .filter(approval => filter === 'all' || approval.final_status === filter)
      .filter(approval => !term || [approval.wi_number, approval.wi_title, approval.revision, approval.submitted_by_name]
        .some(value => value?.toLowerCase().includes(term)))
      .sort((a, b) => {
        const left = sort === 'submitted_at' ? a.submitted_at : sort === 'wi_number' ? a.wi_number : a.final_status
        const right = sort === 'submitted_at' ? b.submitted_at : sort === 'wi_number' ? b.wi_number : b.final_status
        return (left.localeCompare(right)) * (ascending ? 1 : -1)
      })
  }, [approvals, filter, search, sort, ascending])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const setFilterAndReset = (next: Filter) => { setFilter(next); setPage(1) }
  const setSearchAndReset = (value: string) => { setSearch(value); setPage(1) }

  const handleConfirm = async () => {
    if (!modal) return
    if (modal.type === 'approve') await approveStep.mutateAsync({ stepId: modal.stepId, comment })
    else await rejectStep.mutateAsync({ stepId: modal.stepId, comment })
    setModal(null)
    setComment('')
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Approvals' }]}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Approvals</h1>
          <p className="mt-1 text-[13px] text-text-2">Review and action work instruction submissions</p>
        </div>
        <div className="hidden items-center gap-2 rounded-md border border-border bg-bg-2 px-3 py-2 text-[11px] text-text-2 sm:flex">
          <Clock3 size={14} className="text-accent" /> {pending} requiring attention
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <button onClick={() => setFilterAndReset('active')} className="text-left"><StatCard label="Pending" value={pending} color="amber" sub="Needs action" /></button>
        <button onClick={() => setFilterAndReset('done')} className="text-left"><StatCard label="Approved" value={approved} color="green" sub="Completed workflows" /></button>
        <button onClick={() => setFilterAndReset('rejected')} className="text-left"><StatCard label="Rejected" value={rejected} color="red" sub="Needs correction" /></button>
        <button onClick={() => setFilterAndReset('all')} className="text-left"><StatCard label="Total" value={approvals.length} sub="All submissions" /></button>
      </div>

      <Card className="mb-4">
        <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="relative min-w-0">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input value={search} onChange={e => setSearchAndReset(e.target.value)} placeholder="Search WI number, title, revision, or submitter..." className="w-full rounded-md border border-border-2 bg-bg py-2 pl-10 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-3 focus:border-accent" />
          </div>
          <div className="flex items-center gap-2 text-[12px] text-text-2">
            <SlidersHorizontal size={14} />
            <select value={sort} onChange={e => { setSort(e.target.value as SortKey); setPage(1) }} className="rounded-md border border-border-2 bg-bg px-2 py-2 text-text outline-none focus:border-accent">
              <option value="submitted_at">Newest first</option>
              <option value="wi_number">WI number</option>
              <option value="final_status">Status</option>
            </select>
            <button onClick={() => setAscending(value => !value)} className="rounded-md border border-border-2 px-2 py-2 text-text-2 hover:border-accent hover:text-accent" title="Reverse sort"><ChevronDown size={15} className={ascending ? 'rotate-180' : ''} /></button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2">
          {([['all', 'All submissions'], ['active', 'Pending'], ['done', 'Approved'], ['rejected', 'Rejected']] as const).map(([value, label]) => (
            <button key={value} onClick={() => setFilterAndReset(value)} className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] transition-colors ${filter === value ? 'bg-accent-bg font-medium text-accent' : 'text-text-2 hover:bg-bg-3 hover:text-text'}`}>
              {label} <span className="ml-1 font-mono text-[10px]">{value === 'all' ? approvals.length : value === 'active' ? pending : value === 'done' ? approved : rejected}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        {isLoading ? <SkeletonTable rows={8} /> : visible.length === 0 ? (
          <CardBody><div className="py-12 text-center"><Search size={22} className="mx-auto mb-3 text-text-3" /><p className="text-[13px] text-text-2">No approval records match your search</p><p className="mt-1 text-[12px] text-text-3">Try another WI number, title, or status filter.</p></div></CardBody>
        ) : (
          <>
            <div className="hidden items-center gap-4 border-b border-border bg-bg-3 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-text-3 md:flex">
              <span className="min-w-0 flex-[2]">Work instruction</span><span className="min-w-0 flex-1">Submitted by</span><span className="w-28 shrink-0">Submitted</span><span className="w-28 shrink-0">Status</span><span className="w-5 shrink-0" />
            </div>
            {visible.map(approval => {
              const meta = statusMeta(approval.final_status)
              const activeStep = approval.approval_steps?.find(step => step.status === 'active')
              const isExpanded = expanded === approval.id
              return (
                <div key={approval.id} className="border-b border-border last:border-0">
                  <button onClick={() => setExpanded(isExpanded ? null : approval.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3.5 text-left transition-colors hover:bg-bg-3 md:flex md:items-center md:gap-4">
                    <span className="min-w-0 flex-[2]"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-[13px] font-medium text-text">{approval.wi_title}</span><Badge variant="pending">{approval.revision}</Badge></span><span className="mt-1 block font-mono text-[11px] text-accent">{approval.wi_number}</span></span>
                    <span className="hidden min-w-0 flex-1 truncate text-[12px] text-text-2 md:block">{approval.submitted_by_name ?? 'Unknown'}</span>
                    <span className="hidden w-28 shrink-0 text-[11px] text-text-2 md:block">{new Date(approval.submitted_at).toLocaleDateString('en-SG')}</span>
                    <span className="hidden w-28 shrink-0 md:block"><Badge variant={meta.variant}>{meta.label}</Badge></span>
                    <span className="ml-auto flex w-5 shrink-0 items-center justify-end text-text-3">{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                    <span className="col-span-2 flex items-center gap-2 md:hidden"><Badge variant={meta.variant}>{meta.label}</Badge><span className="text-[11px] text-text-3">{approval.submitted_by_name ?? 'Unknown'} · {new Date(approval.submitted_at).toLocaleDateString('en-SG')}</span></span>
                  </button>
                  {isExpanded && <ApprovalDetail approval={approval} onAction={(type, stepId) => { setModal({ type, stepId }); setComment('') }} />}
                  {!isExpanded && activeStep && <div className="-mt-2 px-4 pb-3 md:hidden"><Button size="sm" variant="success" onClick={() => { setModal({ type: 'approve', stepId: activeStep.id }); setComment('') }}>Approve step</Button></div>}
                </div>
              )
            })}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-[11px] text-text-3">
              <span>Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex items-center gap-2"><Button size="sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="font-mono">{page} / {pageCount}</span><Button size="sm" disabled={page === pageCount} onClick={() => setPage(value => value + 1)}>Next</Button></div>
            </div>
          </>
        )}
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.type === 'approve' ? 'Approve step' : 'Reject step'} footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button variant={modal?.type === 'approve' ? 'success' : 'danger'} loading={approveStep.isPending || rejectStep.isPending} disabled={modal?.type === 'reject' && !comment.trim()} onClick={handleConfirm}>{modal?.type === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</Button></>}>
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-text-2">Comment {modal?.type === 'reject' && <span className="text-danger">*</span>}</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder={modal?.type === 'approve' ? 'Optional comment...' : 'Reason for rejection (required)'} className="w-full resize-none rounded-lg border border-border-2 bg-bg px-[14px] py-[10px] text-[13px] text-text outline-none transition-colors placeholder:text-text-3 focus:border-accent" />
      </Modal>
    </AppLayout>
  )
}
