import { useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { Modal } from '@/components/ui/Modal'
import { useApprovals, useApproveStep, useRejectStep } from '@/hooks/useApprovals'

interface Step {
  id: string
  step_number: number
  label: string
  status: string
  comment: string | null
  completed_at: string | null
  approver: { name: string } | null
}

export default function Approvals() {
  const { data: approvals = [], isLoading } = useApprovals()
  const approveStep = useApproveStep()
  const rejectStep  = useRejectStep()

  const [modal, setModal] = useState<{ type: 'approve' | 'reject'; stepId: string } | null>(null)
  const [comment, setComment] = useState('')

  const handleConfirm = async () => {
    if (!modal) return
    if (modal.type === 'approve') {
      await approveStep.mutateAsync({ stepId: modal.stepId, comment })
    } else {
      await rejectStep.mutateAsync({ stepId: modal.stepId, comment })
    }
    setModal(null)
    setComment('')
  }

  const pending   = approvals.filter((a: { final_status: string }) => a.final_status === 'active').length
  const completed = approvals.filter((a: { final_status: string }) => a.final_status === 'done').length
  const rejected  = approvals.filter((a: { final_status: string }) => a.final_status === 'rejected').length

  return (
    <AppLayout breadcrumb={[{ label: 'Approvals' }]}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-[-0.3px]">Approvals</h1>
        <p className="text-[13px] text-text-2 mt-1">Work instruction approval pipeline</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Pending"   value={pending}   color="amber" />
        <StatCard label="Approved"  value={completed} color="green" />
        <StatCard label="Rejected"  value={rejected}  color="red"   />
        <StatCard label="Total"     value={approvals.length} />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1,2].map(i => <div key={i} className="h-48 rounded-[10px] shimmer" />)}
        </div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-16 text-[13px] text-text-3">No approval records found</div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {approvals.map((apr: any) => {
            const steps: Step[] = [...(apr.approval_steps ?? [])].sort(
              (a: Step, b: Step) => a.step_number - b.step_number
            )
            const activeStep = steps.find(s => s.status === 'active')

            return (
              <Card key={apr.id}>
                <CardHeader actions={
                  activeStep ? (
                    <div className="flex gap-2">
                      <Button variant="danger" size="sm"
                        onClick={() => { setModal({ type: 'reject', stepId: activeStep.id }); setComment('') }}>
                        Reject
                      </Button>
                      <Button variant="success" size="sm"
                        onClick={() => { setModal({ type: 'approve', stepId: activeStep.id }); setComment('') }}>
                        Approve Step
                      </Button>
                    </div>
                  ) : null
                }>
                  <span className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-[11px] text-text-3">
                      {apr.work_instructions?.wi_number}
                    </span>
                    <span className="text-text">{apr.work_instructions?.title}</span>
                    <Badge variant="pending">{apr.work_instructions?.revision}</Badge>
                  </span>
                </CardHeader>

                <CardBody>
                  <p className="text-[12px] text-text-2 mb-5">
                    Submitted by <span className="text-text">{apr.submitter?.name ?? '—'}</span>{' '}
                    on {new Date(apr.submitted_at).toLocaleDateString('en-SG')}
                  </p>

                  {/* Pipeline steps */}
                  <div className="flex items-center">
                    {steps.map((step, i) => (
                      <div key={step.id} className="flex items-center flex-1">
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold border-2 ${
                            step.status === 'done'     ? 'border-success bg-success-bg text-success'  :
                            step.status === 'active'   ? 'border-accent bg-accent-bg text-accent'     :
                            step.status === 'rejected' ? 'border-danger bg-danger-bg text-danger'     :
                            'border-border-2 bg-bg-3 text-text-3'
                          }`}>
                            {step.status === 'done' ? '✓' : step.status === 'rejected' ? '✕' : step.step_number}
                          </div>
                          <span className={`text-[10px] text-center leading-tight ${
                            step.status === 'done'   ? 'text-success' :
                            step.status === 'active' ? 'text-accent'  : 'text-text-3'
                          }`}>
                            {step.label}<br/>
                            <span className="text-text-3">{step.approver?.name ?? '—'}</span>
                          </span>
                        </div>
                        {i < steps.length - 1 && (
                          <div className={`h-0.5 w-8 flex-shrink-0 mx-1 ${step.status === 'done' ? 'bg-success' : 'bg-border-2'}`} />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Step comments */}
                  {steps.filter(s => s.comment).map(s => (
                    <div key={s.id} className="mt-3 p-3 bg-bg-3 border border-border rounded-[6px] text-[12px]">
                      <span className="text-text-2">{s.label}:</span>{' '}
                      <span className="text-text">{s.comment}</span>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      {/* Approve/Reject modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.type === 'approve' ? 'Approve Step' : 'Reject Step'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              variant={modal?.type === 'approve' ? 'success' : 'danger'}
              loading={approveStep.isPending || rejectStep.isPending}
              onClick={handleConfirm}
            >
              {modal?.type === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-[11px] font-medium text-text-2 uppercase tracking-[0.08em] mb-1.5">
            Comment {modal?.type === 'reject' && <span className="text-danger">*</span>}
          </label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder={modal?.type === 'approve' ? 'Optional comment…' : 'Reason for rejection (required)'}
            className="w-full px-[14px] py-[10px] bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 resize-none transition-colors"
          />
        </div>
      </Modal>
    </AppLayout>
  )
}
