import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useWorkOrder } from '@/hooks/useWorkOrders'
import {
  useInspectionRecord,
  useStartInspection,
  useRecordFinding,
  useCompleteInspection,
} from '@/hooks/useInspection'
import { useAiAnalysis } from '@/hooks/useAiAnalysis'
import { useToast } from '@/components/ui/Toast'

type FindingResult = 'pass' | 'fail' | 'na'

interface ChecklistItemRow {
  id: string
  item_no: string
  description: string
  acceptance_criteria: string | null
  sort_order: number
}

// ── Circular progress ring ───────────────────────────────────
function ProgressRing({ pct }: { pct: number }) {
  const r = 28, circ = 2 * Math.PI * r
  return (
    <svg width="72" height="72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} strokeWidth="5" className="fill-none stroke-border-2" />
      <circle cx="36" cy="36" r={r} strokeWidth="5"
        className="fill-none stroke-accent transition-all duration-500"
        strokeDasharray={circ}
        strokeDashoffset={circ - (pct / 100) * circ}
        strokeLinecap="round"
      />
      <text x="36" y="36" dominantBaseline="middle" textAnchor="middle"
        className="fill-text font-mono text-[12px] rotate-90 origin-center"
        style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
        {pct}%
      </text>
    </svg>
  )
}

export default function InspectionExecution() {
  const { id: workOrderDbId = '' } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const { data: wo, isLoading: woLoading }   = useWorkOrder(workOrderDbId)
  const { data: record, isLoading: recLoading } = useInspectionRecord(workOrderDbId)

  const startInspection    = useStartInspection()
  const recordFinding      = useRecordFinding()
  const completeInspection = useCompleteInspection()
  const { analyses, analyse, clear: clearAi } = useAiAnalysis()

  // Local state for results not yet saved (optimistic UI)
  const [localResults, setLocalResults] = useState<Record<string, FindingResult>>({})
  const [localNotes,   setLocalNotes]   = useState<Record<string, string>>({})
  const [saving,       setSaving]       = useState<Record<string, boolean>>({})
  const [activeNote,   setActiveNote]   = useState<string | null>(null)

  if (woLoading || recLoading) {
    return (
      <AppLayout breadcrumb={[{ label: 'Inspections', path: '/inspections' }, { label: 'Loading…' }]}>
        <div className="flex flex-col gap-3">
          {[1,2,3].map(i => <div key={i} className="h-20 rounded-[10px] shimmer" />)}
        </div>
      </AppLayout>
    )
  }

  if (!wo) {
    return (
      <AppLayout breadcrumb={[{ label: 'Inspections', path: '/inspections' }, { label: 'Not found' }]}>
        <div className="text-center py-16 text-text-2">Work order not found.</div>
      </AppLayout>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wi    = (wo as any).work_instructions
  const items: ChecklistItemRow[] = wi?.wi_checklist_items
    ? [...wi.wi_checklist_items].sort((a: ChecklistItemRow, b: ChecklistItemRow) => a.sort_order - b.sort_order)
    : []

  const isStarted = !!record
  const isComplete = record?.overall_result !== null && record?.overall_result !== undefined

  // Merge DB findings with local optimistic state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbResults: Record<string, FindingResult> = {}
  if (record?.inspection_findings) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of record.inspection_findings as any[]) {
      if (f.result) dbResults[f.checklist_item_id] = f.result
    }
  }
  const results = { ...dbResults, ...localResults }

  const answered  = Object.keys(results).length
  const passed    = Object.values(results).filter(r => r === 'pass').length
  const failed    = Object.values(results).filter(r => r === 'fail').length
  const pct       = items.length > 0 ? Math.round((answered / items.length) * 100) : 0

  // ── Handlers ─────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      await startInspection.mutateAsync({ workOrderDbId, totalItems: items.length })
      toast('Inspection started', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to start', 'error')
    }
  }

  const handleResult = async (
    itemId: string,
    result: FindingResult,
    item: ChecklistItemRow,
  ) => {
    if (!record) return
    // Toggle off if same result clicked again
    const next = results[itemId] === result ? undefined : result
    if (!next) {
      setLocalResults(prev => { const p = { ...prev }; delete p[itemId]; return p })
      clearAi(itemId)
      return
    }
    setLocalResults(prev => ({ ...prev, [itemId]: next }))
    setSaving(prev => ({ ...prev, [itemId]: true }))
    try {
      await recordFinding.mutateAsync({
        inspectionRecordId: record.id,
        checklistItemId:    itemId,
        result:             next,
        notes:              localNotes[itemId],
      })
      // Trigger AI analysis automatically on fail
      if (next === 'fail') {
        const woData = wo as Record<string, unknown>
        analyse({
          itemId,
          itemDescription:    item.description,
          acceptanceCriteria: item.acceptance_criteria ?? undefined,
          assetName:          woData.asset_name as string | undefined,
          location:           woData.location as string | undefined,
          inspectorNotes:     localNotes[itemId],
        })
      } else {
        clearAi(itemId)
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
      setLocalResults(prev => { const p = { ...prev }; delete p[itemId]; return p })
    } finally {
      setSaving(prev => ({ ...prev, [itemId]: false }))
    }
  }

  const handleComplete = async () => {
    if (!record) return
    if (answered < items.length) {
      toast(`${items.length - answered} items still pending`, 'error')
      return
    }
    const overallResult: FindingResult = failed > 0 ? 'fail' : 'pass'
    try {
      await completeInspection.mutateAsync({
        inspectionRecordId: record.id,
        workOrderDbId,
        overallResult,
      })
      toast('Inspection completed', 'success')
      navigate('/inspections')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to complete', 'error')
    }
  }

  return (
    <AppLayout breadcrumb={[
      { label: 'Inspections', path: '/inspections' },
      { label: (wo as { wo_number?: string }).wo_number ?? workOrderDbId },
    ]}>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[12px] text-accent">{(wo as { wo_number?: string }).wo_number}</span>
            <Badge variant={(wo as { status?: string }).status === 'complete' ? 'complete' : 'open'}>
              {(wo as { status?: string }).status}
            </Badge>
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.3px]">{(wo as { asset_name?: string }).asset_name}</h1>
          <p className="text-[13px] text-text-2 mt-1">
            {(wo as { location?: string }).location} · {wi?.title ?? 'No WI linked'} · {wi?.revision}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <ProgressRing pct={pct} />
          <div className="text-right text-[12px]">
            <p className="text-text-2">{answered}/{items.length} answered</p>
            <p className="text-success">{passed} pass</p>
            <p className="text-danger">{failed} fail</p>
          </div>
        </div>
      </div>

      {/* Not started state */}
      {!isStarted && (
        <Card>
          <CardBody className="flex flex-col items-center py-10 gap-4 text-center">
            <p className="text-[14px] text-text-2">
              This inspection has not been started yet.<br/>
              {items.length} checklist items will be loaded from <span className="text-text">{wi?.wi_number}</span>.
            </p>
            {items.length === 0 ? (
              <p className="text-[13px] text-warning">No checklist items found on the linked work instruction.</p>
            ) : (
              <Button variant="primary" size="lg" loading={startInspection.isPending} onClick={handleStart}>
                Start Inspection
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Completed state */}
      {isComplete && (
        <div className={`mb-4 p-4 rounded-[10px] border text-[13px] font-medium flex items-center gap-3 ${
          record.overall_result === 'pass'
            ? 'bg-success-bg border-success-border text-success'
            : 'bg-danger-bg border-danger-border text-danger'
        }`}>
          {record.overall_result === 'pass' ? '✓ Inspection PASSED' : '✕ Inspection FAILED'}
          <span className="ml-auto font-normal text-[12px] opacity-70">
            Completed {record.completed_at ? new Date(record.completed_at).toLocaleString('en-SG') : ''}
          </span>
        </div>
      )}

      {/* Checklist */}
      {isStarted && items.length > 0 && (
        <Card>
          <div className="px-[18px] py-3 border-b border-border flex items-center justify-between">
            <span className="text-[13px] font-semibold">Checklist — {wi?.title}</span>
            <span className="text-[11px] text-text-3 font-mono">{wi?.revision}</span>
          </div>

          {items.map((item) => {
            const result   = results[item.id]
            const isSaving = saving[item.id]
            const showNote = activeNote === item.id
            const ai       = analyses[item.id]

            return (
              <div key={item.id}
                className={`border-b border-border last:border-0 transition-colors ${
                  result === 'pass' ? 'bg-success-bg/30' :
                  result === 'fail' ? 'bg-danger-bg/30'  : ''
                }`}>
                <div className="flex items-start gap-4 px-[18px] py-4">
                  {/* Item number */}
                  <span className="font-mono text-[11px] text-text-3 w-8 pt-0.5 flex-shrink-0">
                    {item.item_no}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-text">{item.description}</p>
                    {item.acceptance_criteria && (
                      <p className="text-[12px] text-text-2 mt-1">{item.acceptance_criteria}</p>
                    )}

                    {/* Note toggle */}
                    {result === 'fail' && (
                      <button
                        onClick={() => setActiveNote(showNote ? null : item.id)}
                        className="mt-2 text-[11px] text-accent bg-transparent border-none cursor-pointer hover:underline p-0"
                      >
                        {showNote ? '▲ Hide note' : '▼ Add note'}
                      </button>
                    )}
                    {showNote && (
                      <textarea
                        value={localNotes[item.id] ?? ''}
                        onChange={e => setLocalNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="Describe the defect…"
                        rows={2}
                        className="mt-2 w-full px-3 py-2 bg-bg border border-border-2 rounded-[6px] text-[12px] text-text outline-none focus:border-accent resize-none placeholder:text-text-3"
                      />
                    )}

                    {/* ── AI Analysis Panel ─────────────────── */}
                    {(ai?.text || ai?.loading || ai?.error) && (
                      <div className="mt-3 p-3 bg-accent-bg border border-accent-bd rounded-[8px]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-semibold text-accent uppercase tracking-[0.08em]">
                            ✦ AI Analysis
                          </span>
                          {ai.loading && (
                            <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                        {ai.error ? (
                          <p className="text-[12px] text-danger">{ai.error}</p>
                        ) : (
                          <pre className="text-[12px] text-text leading-relaxed whitespace-pre-wrap font-sans">
                            {ai.text}
                            {ai.loading && <span className="animate-pulse">▌</span>}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pass / Fail / N/A buttons */}
                  {!isComplete && (
                    <div className="flex gap-1.5 flex-shrink-0 pt-0.5">
                      {(['pass', 'fail', 'na'] as FindingResult[]).map(r => (
                        <button key={r}
                          disabled={isSaving}
                          onClick={() => handleResult(item.id, r, item)}
                          className={`w-9 h-9 rounded-[6px] border text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40 ${
                            result === r
                              ? r === 'pass' ? 'bg-success-bg border-success-border text-success'
                              : r === 'fail' ? 'bg-danger-bg border-danger-border text-danger'
                              : 'bg-bg-3 border-border-2 text-text-2'
                              : 'bg-transparent border-border-2 text-text-3 hover:border-border-3 hover:text-text'
                          }`}>
                          {r === 'pass' ? '✓' : r === 'fail' ? '✕' : 'NA'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Completed badge */}
                  {isComplete && result && (
                    <Badge variant={result === 'pass' ? 'complete' : result === 'fail' ? 'rejected' : 'draft'}>
                      {result.toUpperCase()}
                    </Badge>
                  )}
                </div>

                {/* Saving indicator */}
                {isSaving && (
                  <div className="px-[18px] pb-2">
                    <span className="text-[11px] text-text-3">Saving…</span>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}

      {/* Complete button */}
      {isStarted && !isComplete && (
        <div className="flex justify-end mt-4 gap-3">
          <p className="text-[12px] text-text-3 self-center">
            {answered}/{items.length} items answered
            {answered < items.length && ` — ${items.length - answered} remaining`}
          </p>
          <Button
            variant="primary"
            size="lg"
            loading={completeInspection.isPending}
            onClick={handleComplete}
          >
            Complete Inspection
          </Button>
        </div>
      )}
    </AppLayout>
  )
}
