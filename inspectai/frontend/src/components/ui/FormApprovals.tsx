import { ValidationSummary } from './ValidationSummary'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApprovals, useApproveStep, useRejectStep } from '@/hooks/useApprovals'
import { useAuth } from '@/context/AuthContext'
import { can } from '@/lib/permissions'
import { Button } from './Button'
import { Modal } from './Modal'
import { api } from '@/lib/api'
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
  const [invalidComment, setInvalidComment] = useState('')
  const [reassignId, setReassignId] = useState(''), [replacementId, setReplacementId] = useState(''), [reason, setReason] = useState('')
  const [replacements, setReplacements] = useState<Array<{id:string;name:string}>>([]), [reassignBusy, setReassignBusy] = useState(false)
  async function openReassignment(stepId: string) {
    setMessage(''); setReplacements([]); setReplacementId(''); setReason(''); setReassignId(stepId)
    try { setReplacements((await api.get<{data:Array<{id:string;name:string}>}>(`/approvals/steps/${stepId}/replacements`)).data.data) }
    catch { setMessage('Replacement reviewers could not be loaded.') }
  }
  async function reassign() {
    setReassignBusy(true); setMessage('')
    try {
      await api.post(`/approvals/steps/${reassignId}/reassign`, {reviewerId:replacementId,reason})
      setReassignId(''); await qc.invalidateQueries({queryKey:['approvals']}); await qc.invalidateQueries({queryKey:['history']}); onChanged()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Reassignment could not be saved.') }
    finally { setReassignBusy(false) }
  }
  async function decide(stepId: string, isApproved: boolean) {
    const step = data.flatMap((r) => r.approval_steps).find((s) => s.id === stepId)
    if ((!isApproved || step?.approver_id !== user?.id) && !comments[stepId]?.trim()) {
      setInvalidComment(stepId)
      return
    }
    setInvalidComment('')
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
      <ValidationSummary
        issues={
          invalidComment && !comments[invalidComment]?.trim()
            ? [
                {
                  id: 'review-comment-' + invalidComment,
                  message: 'Enter a review comment for rejection or an administrator override',
                },
              ]
            : []
        }
      />
      {error && <p role="alert">Approvals could not be loaded.</p>}
      {message && !reassignId && (
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
          {r.submitted_snapshot && <p className="mt-2 text-xs text-text-2">Submitted revision: {r.submitted_snapshot.form.title} · {r.submitted_snapshot.form.revision}</p>}
          {r.stage_blocked && <p role="alert" className="mt-3 text-sm text-danger">This stage is blocked by an unavailable reviewer. An administrator must reassign the affected task with a recorded reason.</p>}
          {r.route_snapshot?.name && (
            <p className="mt-2 text-xs text-text-2">
              Saved route: {r.route_snapshot.name} · {r.route_snapshot.workflowCode} v{r.route_snapshot.versionNumber}
            </p>
          )}
          {r.approval_steps.map((s) => (
            <div key={s.id} className="border-t border-border mt-4 pt-4">
              <p className="text-sm font-semibold">
                {s.label} · {s.group_rule === 'any' && s.stage_size > 1 ? 'Any one · ' : s.group_rule === 'all' && s.stage_size > 1 ? 'All members · ' : ''}Assigned to {s.approver_name} ·{' '}
                {s.skipped
                  ? (r.final_status === 'rejected' ? 'Closed; this run was returned for changes' : 'Not required; another group member approved')
                  : s.status === 'done'
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
              {s.reassignments?.map((change,index) => <p key={index} className="text-xs text-text-2 mt-2">Reassigned {new Date(change.at).toLocaleString()}: {change.reason}</p>)}
              {r.final_status === 'active' && !s.skipped && ['active','wait'].includes(s.status) && s.eligible === false && <div className="mt-3"><p className="text-sm text-danger">{s.approver_name || 'Assigned reviewer'} no longer has eligible independent department access.</p>{can(user,'administrator') && <button className="wf-button mt-2" onClick={() => void openReassignment(s.id)}>Reassign unavailable reviewer</button>}</div>}
              {s.status === 'active' && !s.skipped &&
                can(user, 'form_approver') &&
                r.submitted_by !== user?.id &&
                authorId !== user?.id &&
                (s.approver_id === user?.id || (!r.workflow_version_id && can(user, 'administrator'))) && (
                  <div className="mt-3 space-y-3">
                    <label className="field-label">
                      Review comment
                      <textarea
                        id={'review-comment-' + s.id}
                        aria-label="Review comment"
                        value={comments[s.id] || ''}
                        onChange={(e) => setComments((p) => ({ ...p, [s.id]: e.target.value }))}
                        className="field-input mt-2"
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        disabled={approve.isPending || reject.isPending}
                        onClick={() => decide(s.id, true)}
                      >
                        Approve form
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={approve.isPending || reject.isPending}
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
      <Modal open={!!reassignId} onClose={() => setReassignId('')} title="Reassign unavailable reviewer" footer={<><button className="wf-button" onClick={() => setReassignId('')}>Cancel</button><button className="wf-button wf-primary" disabled={reassignBusy || !replacementId || !reason.trim()} onClick={() => void reassign()}>Confirm reassignment</button></>}>
        <div className="space-y-4">{message && <p role="alert" className="text-danger">{message}</p>}<p className="text-sm text-text-2">The replacement fills this reviewer slot. The saved route, approval rule, required count and completed decisions are preserved.</p><label className="wf-field">Replacement reviewer<select className="field-input" value={replacementId} onChange={(event) => setReplacementId(event.target.value)}><option value="">Select an eligible independent reviewer</option>{replacements.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="wf-field">Reason for reassignment<textarea className="field-input" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)}/></label>{!replacements.length && <p className="text-sm text-text-2">No replacement reviewer is available for this department. Restore eligible access before trying again.</p>}</div>
      </Modal>
    </section>
  )
}
