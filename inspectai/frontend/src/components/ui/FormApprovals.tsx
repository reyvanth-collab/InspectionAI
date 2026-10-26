import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApprovals, useApproveStep, useRejectStep } from '@/hooks/useApprovals'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { Button } from './Button'
export function FormApprovals({
  formId,
  authorId,
  onChanged,
}: {
  formId: string
  authorId?: string
  onChanged: () => void
}) {
  const { user } = useAuth(),
    { data = [], error } = useApprovals(),
    approve = useApproveStep(),
    reject = useRejectStep(),
    qc = useQueryClient()
  const [comments, setComments] = useState<Record<string, string>>({}),
    [message, setMessage] = useState('')
  async function decide(stepId: string, isApproved: boolean) {
    try {
      setMessage('')
      await (isApproved
        ? approve.mutateAsync({ stepId, comment: comments[stepId] })
        : reject.mutateAsync({ stepId, comment: comments[stepId] || '' }))
      onChanged()
      await qc.invalidateQueries({ queryKey: ['history'] })
      await qc.invalidateQueries({ queryKey: ['work-instructions'] })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Decision could not be saved')
    }
  }
  const records = data.filter((r) => r.wi_id === formId)
  return (
    <section aria-label="Approval progress" className="space-y-4">
      {error && <p role="alert">Approvals could not be loaded.</p>}
      {message && (
        <p role="alert" className="text-danger">
          {message}
        </p>
      )}
      {!records.length && (
        <p className="text-sm text-text-2">This draft has not been submitted for approval.</p>
      )}
      {records.map((r) => (
        <article key={r.id} className="border border-border rounded-xl p-4">
          <p className="text-sm font-medium">
            Submitted by {r.submitted_by_name || 'Unknown'} ·{' '}
            {new Date(r.submitted_at).toLocaleString()} ·{' '}
            {r.final_status === 'active'
              ? 'Awaiting approval'
              : r.final_status === 'done'
                ? 'Approved'
                : 'Rejected'}
          </p>
          {r.approval_steps.map((s) => (
            <div key={s.id} className="border-t border-border mt-4 pt-4">
              <p className="text-sm font-semibold">
                {s.label} · Assigned to {s.approver_name} ·{' '}
                {s.status === 'done'
                  ? 'Approved'
                  : s.status === 'wait'
                    ? 'Waiting'
                    : s.status === 'active'
                      ? 'Ready for review'
                      : 'Rejected'}
              </p>
              {['done', 'rejected'].includes(s.status) && (
                <p className="text-xs text-text-2 mt-2">
                  Decision by {s.decision_by_name || 'actor not recorded (legacy)'}
                  {s.completed_at &&
                    ` · ${new Date(s.completed_at).toLocaleString(undefined, { timeZoneName: 'short' })}`}
                </p>
              )}
              {s.comment && <p className="text-sm mt-2">{s.comment}</p>}
              {s.status === 'active' &&
                can(user, 'form_approver') &&
                r.submitted_by !== user?.id &&
                authorId !== user?.id &&
                (s.approver_id === user?.id || can(user, 'administrator')) && (
                  <div className="mt-3 space-y-3">
                    <label className="field-label">
                      Review comment
                      <textarea
                        aria-label="Review comment"
                        value={comments[s.id] || ''}
                        onChange={(e) => setComments((p) => ({ ...p, [s.id]: e.target.value }))}
                        className="field-input mt-2"
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        disabled={
                          approve.isPending ||
                          reject.isPending ||
                          (s.approver_id !== user?.id && !comments[s.id]?.trim())
                        }
                        onClick={() => decide(s.id, true)}
                      >
                        Approve form
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!comments[s.id]?.trim() || approve.isPending || reject.isPending}
                        onClick={() => decide(s.id, false)}
                      >
                        Reject with comment
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          ))}
        </article>
      ))}
    </section>
  )
}
