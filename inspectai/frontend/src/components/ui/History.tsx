import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from './Button'
interface Event {
  id: string
  action: string
  entity_type: string
  actor_name: string | null
  created_at: string
  wi_number?: string
  revision?: string
  detail: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    reason?: string
    comment?: string
  }
}
const labels: Record<string, string> = {
  acceptance_criteria: 'Acceptance criteria',
  description: 'Question / description',
  captured_value: 'Reading / response',
  item_no: 'Question number',
  status: 'Status',
  comment: 'Review comment',
  notes: 'Notes',
  min_value: 'Minimum',
  max_value: 'Maximum',
  layout_json: 'Layout',
  conditional_json: 'Response policy',
  lineage_id: 'Question lineage',
  field_type: 'Response type',
}
function readable(value: unknown): string {
  if (value == null) return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
    try {
      return readable(JSON.parse(value))
    } catch {
      /* legacy plain text */
    }
  }
  if (typeof value === 'object')
    return Array.isArray(value)
      ? value.map(readable).join(', ')
      : Object.entries(value as object)
          .map(
            ([k, v]) =>
              `${k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}: ${readable(v)}`,
          )
          .join('; ')
  return String(value)
}
function eventTitle(event: Event) {
  const before = event.detail?.before || {},
    after = event.detail?.after || {}
  if (event.entity_type === 'work_instructions' && before.status !== after.status) {
    if (after.status === 'active') return 'Form published'
    if (after.status === 'pending_approval') return 'Form submitted for approval'
    if (after.status === 'superseded') return 'Form marked as a previous version'
    if (after.status === 'draft' && before.status) return 'Form returned to draft'
  }
  if (event.entity_type === 'approval_steps' && after.status === 'done') return 'Review approved'
  if (event.entity_type === 'approval_steps' && after.status === 'rejected')
    return 'Review rejected'
  const entity =
    (
      {
        work_instructions: 'Form',
        wi_checklist_items: 'Question',
        work_orders: 'Work order',
        inspection_records: 'Inspection',
        inspection_findings: 'Response',
        approval_records: 'Approval',
        approval_steps: 'Review',
        users: 'Account',
        departments: 'Department',
        wi_revision_history: 'Revision',
      } as Record<string, string>
    )[event.entity_type] || 'Activity'
  const verb = event.action.startsWith('insert.')
    ? 'created'
    : event.action.startsWith('delete.')
      ? 'removed'
      : 'updated'
  return `${entity}${after.item_no || before.item_no ? ' ' + String(after.item_no || before.item_no) : ''} ${verb}`
}
export function History({ formId, workOrderId }: { formId?: string; workOrderId?: string }) {
  const [page, setPage] = useState(1)
  const { data, isLoading, error } = useQuery({
    queryKey: ['history', formId, workOrderId, page],
    queryFn: async () =>
      (
        await api.get<{ data: Event[]; meta: { total: number; hasMore: boolean } }>(
          `/history?${new URLSearchParams({ ...(formId ? { formId } : {}), ...(workOrderId ? { workOrderId } : {}), page: String(page) })}`,
        )
      ).data,
  })
  return (
    <section aria-label="History" className="space-y-4">
      {isLoading && <p>Loading history…</p>}
      {error && (
        <p role="alert" className="text-danger">
          History could not be loaded. Please try again.
        </p>
      )}
      {data?.data.length === 0 && (
        <p className="text-sm text-text-2">
          No recorded history. Older records may predate detailed change capture.
        </p>
      )}
      {data?.data.map((e) => {
        const before = e.detail?.before || {},
          after = e.detail?.after || {},
          keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
            (k) =>
              ![
                'id',
                'tenant_id',
                'updated_at',
                'created_at',
                'owner_id',
                'department_id',
                'work_instruction_id',
                'inspection_record_id',
                'checklist_item_id',
                'asset_record_id',
                'assigned_to',
                'created_by',
                'lineage_id',
                'previous_revision_id',
                'approval_record_id',
                'approver_id',
                'submitted_by',
                'signed_by',
                'inspector_id',
              ].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
          )
        return (
          <article key={e.id} className="border border-border rounded-xl p-4 bg-bg-2">
            <div className="flex flex-wrap gap-2 justify-between">
              <strong className="text-sm">{eventTitle(e)}</strong>
              <time className="text-xs text-text-2" dateTime={e.created_at}>
                {new Date(e.created_at).toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZoneName: 'short',
                })}
              </time>
            </div>
            <p className="text-xs text-text-2 mt-2">
              {e.actor_name || 'Actor not recorded (legacy / unavailable)'}
              {e.wi_number && ` · ${e.wi_number} · ${e.revision}`}
              {!!(after.item_no || before.item_no) &&
                ` · Question ${after.item_no || before.item_no}`}
            </p>
            {e.detail?.reason && <p className="text-sm mt-2">{e.detail.reason}</p>}
            {keys.length > 0 && (
              <dl className="mt-3 space-y-3">
                {keys.map((k) => (
                  <div key={k} className="text-sm">
                    <dt className="font-medium">{labels[k] || k.replace(/_/g, ' ')}</dt>
                    <dd className="grid sm:grid-cols-2 gap-2 mt-1">
                      <span className="bg-bg-3 rounded p-2 history-value">
                        <span className="text-text-2 text-xs block">Previous</span>
                        {readable(before[k])}
                      </span>
                      <span className="bg-accent-bg rounded p-2 history-value">
                        <span className="text-text-2 text-xs block">New</span>
                        {readable(after[k])}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        )
      })}
      {data && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-text-2">
            Page {page} · {data.meta.total} events
          </span>
          <Button
            variant="secondary"
            disabled={!data.meta.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}
