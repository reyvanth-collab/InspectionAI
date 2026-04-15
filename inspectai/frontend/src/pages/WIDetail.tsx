import { useParams, useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useWorkInstruction } from '@/hooks/useWorkInstructions'
import type { WIStatus } from '@/types'

const STATUS_MAP: Record<string, WIStatus> = {
  active:           'active',
  expiring:         'expiring',
  expired:          'expired',
  draft:            'draft',
  pending_approval: 'pending_approval',
  superseded:       'superseded',
}

interface ChecklistItem {
  id: string; item_no: string; description: string
  acceptance_criteria: string | null; category: string | null; sort_order: number
}
interface RevisionHistory {
  id: string; revision: string; change_summary: string | null
  effective_date: string | null; approved_by: string | null
}

export default function WIDetail() {
  const { id: dbId = '' } = useParams()
  const navigate          = useNavigate()
  const { data: wi, isLoading } = useWorkInstruction(dbId)

  if (isLoading) {
    return (
      <AppLayout breadcrumb={[{ label: 'Master Library', path: '/library' }, { label: 'Loading…' }]}>
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-[10px] shimmer" />)}
        </div>
      </AppLayout>
    )
  }

  if (!wi) {
    return (
      <AppLayout breadcrumb={[{ label: 'Master Library', path: '/library' }, { label: 'Not found' }]}>
        <div className="text-center py-16 text-text-2">Work instruction not found.</div>
      </AppLayout>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = wi as any
  const items: ChecklistItem[]    = [...(w.wi_checklist_items ?? [])].sort(
    (a: ChecklistItem, b: ChecklistItem) => a.sort_order - b.sort_order
  )
  const history: RevisionHistory[] = [...(w.wi_revision_history ?? [])].sort(
    (a: RevisionHistory, b: RevisionHistory) =>
      new Date(b.effective_date ?? 0).getTime() - new Date(a.effective_date ?? 0).getTime()
  )

  const today        = new Date()
  const expiry       = w.expiry_date ? new Date(w.expiry_date) : null
  const daysRemaining = expiry ? Math.round((expiry.getTime() - today.getTime()) / 86_400_000) : null

  return (
    <AppLayout breadcrumb={[
      { label: 'Master Library', path: '/library' },
      { label: w.wi_number },
    ]}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[12px] text-accent">{w.wi_number}</span>
            <span className="font-mono text-[11px] text-text-3">{w.revision}</span>
            <Badge variant={STATUS_MAP[w.status] ?? 'draft'}>{w.status}</Badge>
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.3px]">{w.title}</h1>
          <p className="text-[13px] text-text-2 mt-1">
            {w.category} · Owner: {w.users?.name ?? '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(`/approvals`)}>Submit for Approval</Button>
          <Button variant="primary">Edit WI</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Left — checklist items */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader actions={
              <span className="text-[12px] text-text-3 font-mono">{items.length} items</span>
            }>
              Checklist Items
            </CardHeader>
            {items.length === 0 ? (
              <CardBody>
                <p className="text-[13px] text-text-3">No checklist items yet.</p>
              </CardBody>
            ) : (
              items.map(item => (
                <div key={item.id}
                  className="flex items-start gap-3 px-[18px] py-3 border-b border-border last:border-0">
                  <span className="font-mono text-[11px] text-text-3 w-8 pt-0.5 flex-shrink-0">
                    {item.item_no}
                  </span>
                  <div className="flex-1">
                    <p className="text-[13px] text-text">{item.description}</p>
                    {item.acceptance_criteria && (
                      <p className="text-[11px] text-text-2 mt-0.5">{item.acceptance_criteria}</p>
                    )}
                  </div>
                  {item.category && (
                    <span className="text-[10px] text-text-3 bg-bg-3 border border-border px-2 py-0.5 rounded-full flex-shrink-0">
                      {item.category}
                    </span>
                  )}
                </div>
              ))
            )}
          </Card>

          {/* Revision history */}
          <Card>
            <CardHeader>Revision History</CardHeader>
            <CardBody className="p-0">
              {history.length === 0 ? (
                <div className="px-[18px] py-4 text-[13px] text-text-3">No revision history.</div>
              ) : (
                history.map((rev, i) => (
                  <div key={rev.id} className="flex gap-3 px-[18px] py-3 border-b border-border last:border-0">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center pt-1 gap-1">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-accent' : 'bg-border-2'}`} />
                      {i < history.length - 1 && <div className="w-0.5 flex-1 bg-border min-h-[16px]" />}
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-medium text-text">{rev.revision}</span>
                        {rev.effective_date && (
                          <span className="text-[11px] text-text-3 font-mono">{rev.effective_date}</span>
                        )}
                      </div>
                      {rev.change_summary && (
                        <p className="text-[12px] text-text-2 mt-0.5">{rev.change_summary}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right — metadata */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>Metadata</CardHeader>
            <CardBody className="flex flex-col gap-3">
              {[
                { label: 'WI Number',      value: w.wi_number },
                { label: 'Revision',       value: w.revision },
                { label: 'Category',       value: w.category ?? '—' },
                { label: 'Owner',          value: w.users?.name ?? '—' },
                { label: 'Effective Date', value: w.effective_date ?? '—' },
                { label: 'Expiry Date',    value: w.expiry_date ?? '—' },
                {
                  label: 'Days Remaining',
                  value: daysRemaining === null ? '—'
                    : daysRemaining < 0 ? `Expired ${Math.abs(daysRemaining)}d ago`
                    : `${daysRemaining}d`,
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-2">
                  <span className="text-[11px] text-text-2 uppercase tracking-[0.07em]">{label}</span>
                  <span className={`text-[12px] font-mono text-right ${
                    label === 'Days Remaining' && daysRemaining !== null
                      ? daysRemaining < 0    ? 'text-danger'
                      : daysRemaining <= 30  ? 'text-warning'
                      : 'text-success'
                      : 'text-text'
                  }`}>
                    {value}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>

          {w.pdf_url && (
            <Card>
              <CardHeader>Source Document</CardHeader>
              <CardBody>
                <a href={w.pdf_url} target="_blank" rel="noopener noreferrer"
                  className="text-[13px] text-accent hover:underline">
                  View PDF →
                </a>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
