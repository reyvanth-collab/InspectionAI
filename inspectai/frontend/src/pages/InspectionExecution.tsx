import { useState, useRef, useCallback, useEffect } from 'react'
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
import { useMomsWiSummary, type MomsWiSummary } from '@/hooks/useMomsWiSummary'
import { useToast } from '@/components/ui/Toast'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { useAuth } from '@/context/AuthContext'
import { useOffline } from '@/context/OfflineContext'
import { JWT_KEY } from '@/lib/api'
import { cn } from '@/lib/cn'

type FindingResult = 'pass' | 'fail' | 'na'
type FieldType = 'pass_fail' | 'text' | 'number' | 'dropdown' | 'yes_no' |
                 'multiselect' | 'date' | 'measurement' | 'photo' | 'textarea' |
                 'signature' | 'heading'

interface ChecklistItemRow {
  id:                  string
  item_no:             string
  description:         string
  acceptance_criteria: string | null
  sort_order:          number
  field_type?:         FieldType | null
  required?:           boolean
  placeholder?:        string | null
  options_json?:       string | null
  unit?:               string | null
  min_value?:          number | null
  max_value?:          number | null
  conditional_json?:   string | null
}

interface CompletionSummary {
  overallResult: FindingResult; passed: number; failed: number; na: number; total: number
  failedItems: Array<{ item_no: string; description: string; note?: string }>
  completedAt: string; signatureDataUrl: string; inspectorName: string
  woNumber: string; assetName: string; wiNumber: string; wiTitle: string; location: string
}

// ── Draft key ─────────────────────────────────────────────────────
const draftKey = (woId: string) => `inspection_draft_${woId}`

// ── Timer hook ────────────────────────────────────────────────────
function useTimer(running: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${seconds % 60}s`
}

// ── Progress ring ─────────────────────────────────────────────────
function ProgressRing({ pct }: { pct: number }) {
  const r = 28, circ = 2 * Math.PI * r
  return (
    <svg width="72" height="72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} strokeWidth="5" className="fill-none stroke-border-2" />
      <circle cx="36" cy="36" r={r} strokeWidth="5"
        className="fill-none stroke-accent transition-all duration-500"
        strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ} strokeLinecap="round" />
      <text x="36" y="36" dominantBaseline="middle" textAnchor="middle"
        className="fill-text font-mono text-[12px] rotate-90 origin-center"
        style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{pct}%</text>
    </svg>
  )
}

// ── MOMS banner ───────────────────────────────────────────────────
function MomsBanner({ data }: { data: MomsWiSummary }) {
  const [open, setOpen] = useState(true)
  const riskColor = data.nokRate >= 20
    ? 'border-danger-border bg-danger-bg/30 text-danger'
    : data.nokRate >= 10
    ? 'border-warning-border bg-warning-bg/20 text-warning'
    : 'border-success-border bg-success-bg/20 text-success'

  return (
    <div className={`mb-4 border rounded-[10px] overflow-hidden ${riskColor}`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left">
        <span className="text-[13px]">📊</span>
        <div className="flex-1">
          <span className="text-[12px] font-semibold">MOMS Historical Data</span>
          <span className="text-[11px] ml-2 opacity-70">
            {data.nokRate.toFixed(1)}% NOK across {data.totalInspections} past work order{data.totalInspections !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-[11px] opacity-50">{open ? '▲' : '▼'}</span>
      </button>
      {open && data.topNokSteps.length > 0 && (
        <div className="px-4 pb-4 border-t border-current/20">
          <p className="text-[10px] opacity-50 mt-3 mb-2 uppercase tracking-[0.08em] font-semibold">
            Recurring failures ({data.topNokSteps.length} steps)
          </p>
          {data.topNokSteps.map((s, i) => (
            <div key={i} className="flex items-start gap-2 mb-1">
              <span className="opacity-40 flex-shrink-0 font-mono text-[10px] mt-0.5 w-4">#{i+1}</span>
              <span className="flex-1 text-[12px] opacity-90 line-clamp-1">{s.step_desc ?? s.step_no ?? '—'}</span>
              <span className="flex-shrink-0 font-semibold font-mono text-[11px]">{parseFloat(s.nok_rate).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Photo + Vision AI panel ───────────────────────────────────────
function PhotoAnalysisPanel({ itemDescription, acceptanceCriteria, assetName, location }: {
  itemDescription: string; acceptanceCriteria?: string | null
  assetName?: string; location?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ text: string; loading: boolean; error: string | null } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const analysePhoto = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file))
    setState({ text: '', loading: true, error: null })
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const mediaType = (file.type as 'image/jpeg' | 'image/png' | 'image/webp') || 'image/jpeg'
      const token = localStorage.getItem(JWT_KEY) ?? ''
      const res = await fetch('/api/ai/analyse-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ imageBase64: base64, mediaType, itemDescription, acceptanceCriteria, assetName, location }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader2 = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader2.read()
        if (done) break
        for (const line of decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))) {
          const json = line.slice(6).trim()
          if (json === '[DONE]') { setState(p => p ? { ...p, loading: false } : p); break }
          try {
            const parsed = JSON.parse(json) as { text?: string; error?: string }
            if (parsed.error) throw new Error(parsed.error)
            if (parsed.text) setState(p => p ? { ...p, text: p.text + parsed.text } : p)
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setState({ text: '', loading: false, error: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setState(p => p ? { ...p, loading: false } : p)
    }
  }, [itemDescription, acceptanceCriteria, assetName, location])

  return (
    <div className="mt-2">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) analysePhoto(f); e.target.value = '' }} />
      {!state && (
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 text-[11px] text-text-3 hover:text-accent bg-transparent border-none cursor-pointer p-0 transition-colors">
          📷 Attach photo for AI Vision analysis
        </button>
      )}
      {state && (
        <div className="mt-2 p-3 bg-bg-3 border border-border-2 rounded-[8px]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold text-text-2 uppercase tracking-[0.08em]">📷 Vision Analysis</span>
            {state.loading && <span className="w-3 h-3 border border-text-2 border-t-transparent rounded-full animate-spin" />}
            {preview && <img src={preview} alt="" className="ml-auto h-8 w-8 object-cover rounded border border-border" />}
            <button onClick={() => { setState(null); setPreview(null) }}
              className="text-text-3 hover:text-text text-[11px] bg-transparent border-none cursor-pointer p-0">✕</button>
          </div>
          {state.error
            ? <p className="text-[12px] text-danger">{state.error}</p>
            : <pre className="text-[12px] text-text leading-relaxed whitespace-pre-wrap font-sans">
                {state.text}{state.loading && <span className="animate-pulse">▌</span>}
              </pre>
          }
        </div>
      )}
    </div>
  )
}

// ── Field input renderers ─────────────────────────────────────────
function FieldInput({
  item, value, onChange,
}: {
  item: ChecklistItemRow
  value: string
  onChange: (v: string) => void
}) {
  const type = item.field_type ?? 'pass_fail'
  const CLS  = 'w-full px-3 py-2 bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'

  if (type === 'text') {
    return (
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder={item.placeholder ?? 'Enter text…'} className={CLS} />
    )
  }
  if (type === 'textarea') {
    return (
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
        placeholder={item.placeholder ?? 'Enter notes…'} className={CLS + ' resize-none'} />
    )
  }
  if (type === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          min={item.min_value ?? undefined} max={item.max_value ?? undefined}
          placeholder="0" className={CLS} />
        {(item.min_value != null || item.max_value != null) && (
          <span className="text-[11px] text-text-3 whitespace-nowrap flex-shrink-0">
            {item.min_value != null && `min ${item.min_value}`}
            {item.min_value != null && item.max_value != null && ' – '}
            {item.max_value != null && `max ${item.max_value}`}
          </span>
        )}
      </div>
    )
  }
  if (type === 'measurement') {
    return (
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          min={item.min_value ?? undefined} max={item.max_value ?? undefined}
          placeholder="0.0" className={CLS} />
        <span className="px-3 py-2 bg-bg-3 border border-border rounded-[8px] text-[12px] font-mono text-text-2 flex-shrink-0">
          {item.unit ?? 'unit'}
        </span>
      </div>
    )
  }
  if (type === 'dropdown') {
    const opts = item.options_json ? (JSON.parse(item.options_json) as string[]) : []
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={CLS}>
        <option value="">Select…</option>
        {opts.map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
      </select>
    )
  }
  if (type === 'multiselect') {
    const opts     = item.options_json ? (JSON.parse(item.options_json) as string[]) : []
    const selected = value ? (value.split(',') as string[]) : []
    const toggle   = (opt: string) => {
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]
      onChange(next.join(','))
    }
    return (
      <div className="flex flex-col gap-1.5 mt-1">
        {opts.map((opt, i) => (
          <label key={i} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)}
              className="rounded accent-accent" />
            <span className="text-[13px] text-text">{opt}</span>
          </label>
        ))}
      </div>
    )
  }
  if (type === 'date') {
    return <input type="date" value={value} onChange={e => onChange(e.target.value)} className={CLS} />
  }
  if (type === 'yes_no') {
    return (
      <div className="flex gap-2 mt-1">
        {[{ v: 'yes', label: 'Yes', cls: value === 'yes' ? 'bg-success-bg border-success-border text-success' : 'border-border-2 text-text-3 hover:border-success/50' },
          { v: 'no',  label: 'No',  cls: value === 'no'  ? 'bg-danger-bg border-danger-border text-danger'   : 'border-border-2 text-text-3 hover:border-danger/50' }].map(b => (
          <button key={b.v} onClick={() => onChange(value === b.v ? '' : b.v)}
            className={`flex-1 h-11 rounded-[8px] border text-[13px] font-semibold bg-transparent cursor-pointer transition-all active:scale-[0.98] ${b.cls}`}>
            {b.label}
          </button>
        ))}
      </div>
    )
  }
  // pass_fail and others — no extra input, handled by the main buttons
  return null
}

// ── Main component ────────────────────────────────────────────────
export default function InspectionExecution() {
  const { id: workOrderDbId = '' } = useParams()
  const navigate = useNavigate()
  const { toast }    = useToast()
  const { user }     = useAuth()
  const { isOnline, enqueue } = useOffline()

  const { data: wo, isLoading: woLoading }      = useWorkOrder(workOrderDbId)
  const { data: record, isLoading: recLoading } = useInspectionRecord(workOrderDbId)

  // Hoist WI number before any early returns (hook order must be constant)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wi       = (wo as any)?.work_instructions
  const wiNumber = wi?.wi_number as string | undefined

  // All hooks unconditional
  const startInspection    = useStartInspection()
  const recordFinding      = useRecordFinding()
  const completeInspection = useCompleteInspection()
  const { analyses, analyse, clear: clearAi } = useAiAnalysis()
  const { data: momsData }                    = useMomsWiSummary(wiNumber)

  const [localResults,  setLocalResults]  = useState<Record<string, FindingResult>>({})
  const [localValues,   setLocalValues]   = useState<Record<string, string>>({})  // field input values → stored in notes
  const [localNotes,    setLocalNotes]    = useState<Record<string, string>>({})
  const [saving,        setSaving]        = useState<Record<string, boolean>>({})
  const [activeNote,    setActiveNote]    = useState<string | null>(null)
  const [showSignature, setShowSignature] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [completionSummary, setCompletionSummary] = useState<CompletionSummary | null>(null)

  const timerLabel = useTimer(!!record && !completionSummary)

  // ── Restore draft from localStorage ──────────────────────────
  const draftRestored = useRef(false)
  useEffect(() => {
    if (!workOrderDbId || draftRestored.current) return
    const raw = localStorage.getItem(draftKey(workOrderDbId))
    if (!raw) return
    try {
      const draft = JSON.parse(raw) as {
        results?: Record<string, FindingResult>
        values?:  Record<string, string>
        notes?:   Record<string, string>
      }
      if (draft.results) setLocalResults(draft.results)
      if (draft.values)  setLocalValues(draft.values)
      if (draft.notes)   setLocalNotes(draft.notes)
      draftRestored.current = true
    } catch { /* ignore */ }
  }, [workOrderDbId])

  // ── Auto-save draft to localStorage ──────────────────────────
  const saveDraft = useCallback(() => {
    if (!workOrderDbId) return
    localStorage.setItem(draftKey(workOrderDbId), JSON.stringify({
      results: localResults,
      values:  localValues,
      notes:   localNotes,
    }))
  }, [workOrderDbId, localResults, localValues, localNotes])

  useEffect(() => { saveDraft() }, [saveDraft])

  // ── Loading / not-found ───────────────────────────────────────
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

  const woData = wo as Record<string, unknown>
  const items: ChecklistItemRow[] = wi?.wi_checklist_items
    ? [...wi.wi_checklist_items].sort((a: ChecklistItemRow, b: ChecklistItemRow) => a.sort_order - b.sort_order)
    : []

  // Exclude headings from completion tracking
  const checkableItems = items.filter(i => (i.field_type ?? 'pass_fail') !== 'heading')
  const requiredItems  = checkableItems.filter(i => i.required !== false)

  const isStarted  = !!record
  const isComplete = record?.overall_result != null

  const dbResults: Record<string, FindingResult> = {}
  if (record?.inspection_findings) {
    for (const f of record.inspection_findings as Array<{ checklist_item_id: string; result: FindingResult }>) {
      if (f.result) dbResults[f.checklist_item_id] = f.result
    }
  }
  const results  = { ...dbResults, ...localResults }
  const answered = checkableItems.filter(i => results[i.id] != null).length
  const passed   = Object.values(results).filter(r => r === 'pass').length
  const failed   = Object.values(results).filter(r => r === 'fail').length
  const naCount  = Object.values(results).filter(r => r === 'na').length
  const pct      = checkableItems.length > 0 ? Math.round((answered / checkableItems.length) * 100) : 0

  // ── Handlers ─────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      await startInspection.mutateAsync({ workOrderDbId, totalItems: checkableItems.length })
      toast('Inspection started', 'success')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to start', 'error') }
  }

  const handleResult = async (itemId: string, result: FindingResult, item: ChecklistItemRow) => {
    if (!record) return
    const next = results[itemId] === result ? undefined : result
    if (!next) {
      setLocalResults(prev => { const p = { ...prev }; delete p[itemId]; return p })
      clearAi(itemId); return
    }
    setLocalResults(prev => ({ ...prev, [itemId]: next }))
    setSaving(prev => ({ ...prev, [itemId]: true }))
    try {
      const notesForItem = localValues[itemId]
        ? `${localValues[itemId]}${localNotes[itemId] ? '\n' + localNotes[itemId] : ''}`
        : localNotes[itemId]
      await recordFinding.mutateAsync({
        inspectionRecordId: record.id,
        checklistItemId:    itemId,
        result:             next,
        notes:              notesForItem,
      })
      if (next === 'fail') {
        const momsMatch = momsData?.topNokSteps.find(s =>
          s.step_desc && (
            s.step_desc.toLowerCase().includes(item.description.toLowerCase().slice(0, 40)) ||
            item.description.toLowerCase().includes((s.step_desc).toLowerCase().slice(0, 40))
          )
        )
        analyse({
          itemId,
          itemDescription:       item.description,
          acceptanceCriteria:    item.acceptance_criteria ?? undefined,
          assetName:             woData.asset_name as string | undefined,
          location:              woData.location as string | undefined,
          inspectorNotes:        localNotes[itemId],
          momsHistoricalNokRate: momsMatch ? parseFloat(momsMatch.nok_rate) : momsData?.nokRate,
          momsHistoricalTotal:   momsMatch ? parseInt(momsMatch.total) : momsData?.totalInspections,
        })
      } else { clearAi(itemId) }
    } catch (e) {
      if (!isOnline) {
        enqueue({
          endpoint: `/inspections/${workOrderDbId}/findings`,
          method:   'POST',
          body:     {
            inspectionRecordId: record!.id,
            checklistItemId:    itemId,
            result:             next,
            notes:              localValues[itemId]
              ? `${localValues[itemId]}${localNotes[itemId] ? '\n' + localNotes[itemId] : ''}`
              : localNotes[itemId],
          },
          label: `${item.item_no} — ${next}`,
        })
        toast('Offline — result saved locally, will sync on reconnect', 'info')
      } else {
        toast(e instanceof Error ? e.message : 'Save failed', 'error')
        setLocalResults(prev => { const p = { ...prev }; delete p[itemId]; return p })
      }
    } finally {
      setSaving(prev => ({ ...prev, [itemId]: false }))
    }
  }

  const handleCompleteClick = () => {
    if (!record) return
    const missing = requiredItems.filter(i => results[i.id] == null)
    if (missing.length > 0) {
      toast(`${missing.length} required item${missing.length > 1 ? 's' : ''} still pending`, 'error')
      // Scroll to first missing
      const el = document.getElementById(`item-${missing[0].id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setShowSignature(true)
  }

  const handleSignatureApplied = async (dataUrl: string) => {
    setSignatureDataUrl(dataUrl)
    setShowSignature(false)
    if (!record) return
    const overallResult: FindingResult = failed > 0 ? 'fail' : 'pass'
    try {
      await completeInspection.mutateAsync({ inspectionRecordId: record.id, workOrderDbId, overallResult })
      localStorage.removeItem(draftKey(workOrderDbId))
      toast('Inspection completed and signed', 'success')
      setCompletionSummary({
        overallResult,
        passed, failed, na: naCount, total: checkableItems.length,
        failedItems: checkableItems.filter(i => results[i.id] === 'fail').map(i => ({
          item_no: i.item_no, description: i.description, note: localNotes[i.id],
        })),
        completedAt:      new Date().toISOString(),
        signatureDataUrl: dataUrl,
        inspectorName:    user?.name ?? '—',
        woNumber:         (woData.wo_number as string) ?? '',
        assetName:        (woData.asset_name as string) ?? '',
        wiNumber:         wi?.wi_number ?? '',
        wiTitle:          wi?.title ?? '',
        location:         (woData.location as string) ?? '',
      })
    } catch (e) {
      setSignatureDataUrl(null)
      toast(e instanceof Error ? e.message : 'Failed to complete', 'error')
    }
  }

  // ── Completion screen ─────────────────────────────────────────
  if (completionSummary) {
    return <CompletionSummaryScreen summary={completionSummary} onBack={() => navigate('/inspections')} />
  }

  // ── Progress bar ──────────────────────────────────────────────
  const ProgressBar = () => (
    <div className="mb-5">
      <div className="h-1 bg-bg-3 rounded-full overflow-hidden mb-1.5">
        <div className="h-full bg-accent rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-text-3">
        {answered} of {checkableItems.length} complete
        {failed > 0 && <span className="text-danger ml-2">· {failed} failed</span>}
      </p>
    </div>
  )

  // ── Main view ─────────────────────────────────────────────────
  return (
    <AppLayout breadcrumb={[
      { label: 'Inspections', path: '/inspections' },
      { label: (woData.wo_number as string) ?? workOrderDbId },
    ]}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[12px] text-accent">{woData.wo_number as string}</span>
            <Badge variant={(woData.status as string) === 'complete' ? 'complete' : 'open'}>
              {woData.status as string}
            </Badge>
            {isStarted && !isComplete && (
              <span className="font-mono text-[11px] text-text-3">{timerLabel}</span>
            )}
          </div>
          <h1 className="text-[20px] font-semibold tracking-[-0.3px]">{woData.asset_name as string}</h1>
          <p className="text-[13px] text-text-2 mt-0.5">
            {woData.location as string} · {wi?.title ?? 'No WI linked'} · {wi?.revision}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProgressRing pct={pct} />
          <div className="text-right text-[12px] leading-relaxed">
            <p className="text-text-2">{answered}/{checkableItems.length} answered</p>
            <p className="text-success">{passed} pass</p>
            <p className="text-danger">{failed} fail</p>
          </div>
        </div>
      </div>

      {isStarted && <ProgressBar />}

      {/* MOMS historical context */}
      {momsData && <MomsBanner data={momsData} />}

      {/* Not started */}
      {!isStarted && (
        <Card>
          <CardBody className="flex flex-col items-center py-10 gap-4 text-center">
            <p className="text-[14px] text-text-2">
              This inspection has not been started yet.<br />
              {checkableItems.length} checklist items from{' '}
              <span className="text-text font-mono">{wi?.wi_number}</span>.
            </p>
            {checkableItems.length === 0 ? (
              <p className="text-[13px] text-warning">No checklist items on the linked work instruction.</p>
            ) : (
              <Button variant="primary" size="lg" loading={startInspection.isPending} onClick={handleStart}>
                Start Inspection
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Completed banner */}
      {isComplete && (
        <div className={cn(
          'mb-4 p-4 rounded-[10px] border text-[13px] font-medium flex items-center gap-3',
          record.overall_result === 'pass'
            ? 'bg-success-bg border-success-border text-success'
            : 'bg-danger-bg border-danger-border text-danger'
        )}>
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

          {items.map(item => {
            const ft       = item.field_type ?? 'pass_fail'
            const result   = results[item.id]
            const isSaving = saving[item.id]
            const showNote = activeNote === item.id
            const ai       = analyses[item.id]
            const fieldVal = localValues[item.id] ?? ''

            // Section heading
            if (ft === 'heading') {
              return (
                <div key={item.id}
                  className="px-[18px] py-2.5 bg-bg-3 border-b border-border flex items-center">
                  <span className="text-[11px] font-bold text-text uppercase tracking-[0.07em]">{item.description}</span>
                </div>
              )
            }

            return (
              <div key={item.id} id={`item-${item.id}`}
                className={cn(
                  'border-b border-border last:border-0 transition-colors',
                  result === 'pass' ? 'bg-success-bg/20' :
                  result === 'fail' ? 'bg-danger-bg/15'  : ''
                )}>
                <div className="flex items-start gap-4 px-[18px] py-4">
                  <span className="font-mono text-[11px] text-text-3 w-8 pt-0.5 flex-shrink-0">{item.item_no}</span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5 mb-1">
                      <p className="text-[14px] font-medium text-text flex-1">{item.description}</p>
                      {item.required !== false && (
                        <span className="text-[10px] text-danger flex-shrink-0 mt-0.5">*</span>
                      )}
                    </div>
                    {item.acceptance_criteria && (
                      <p className="text-[12px] text-text-2 italic mb-2">{item.acceptance_criteria}</p>
                    )}

                    {/* Field-type specific input (for non pass_fail types) */}
                    {!isComplete && !['pass_fail'].includes(ft) && (
                      <div className="mb-3">
                        <FieldInput item={item} value={fieldVal}
                          onChange={v => setLocalValues(prev => ({ ...prev, [item.id]: v }))} />
                      </div>
                    )}

                    {/* Fail note + photo */}
                    {result === 'fail' && (
                      <>
                        <button onClick={() => setActiveNote(showNote ? null : item.id)}
                          className="mt-1 mb-1 text-[11px] text-accent bg-transparent border-none cursor-pointer hover:underline p-0">
                          {showNote ? '▲ Hide note' : '▼ Add note'}
                        </button>
                        {showNote && (
                          <textarea
                            value={localNotes[item.id] ?? ''}
                            onChange={e => setLocalNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                            placeholder="Describe the defect…"
                            rows={2}
                            className="mt-1 w-full px-3 py-2 bg-bg border border-border-2 rounded-[6px] text-[12px] text-text outline-none focus:border-accent resize-none placeholder:text-text-3"
                          />
                        )}
                        <PhotoAnalysisPanel
                          itemDescription={item.description}
                          acceptanceCriteria={item.acceptance_criteria}
                          assetName={woData.asset_name as string}
                          location={woData.location as string}
                        />
                      </>
                    )}

                    {/* AI analysis */}
                    {(ai?.text || ai?.loading || ai?.error) && (
                      <div className="mt-3 p-3 bg-accent-bg border border-accent-bd rounded-[8px]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-semibold text-accent uppercase tracking-[0.08em]">✦ AI Analysis</span>
                          {ai.loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />}
                        </div>
                        {ai.error
                          ? <p className="text-[12px] text-danger">{ai.error}</p>
                          : <pre className="text-[12px] text-text leading-relaxed whitespace-pre-wrap font-sans">
                              {ai.text}{ai.loading && <span className="animate-pulse">▌</span>}
                            </pre>
                        }
                      </div>
                    )}
                  </div>

                  {/* Pass / Fail / NA buttons */}
                  {!isComplete && (
                    <div className="flex flex-col gap-1 flex-shrink-0 pt-0.5">
                      {(['pass', 'fail', 'na'] as FindingResult[]).map(r => (
                        <button key={r}
                          disabled={isSaving}
                          onClick={() => handleResult(item.id, r, item)}
                          className={cn(
                            'w-10 h-10 rounded-[7px] border text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 active:scale-[0.96]',
                            result === r
                              ? r === 'pass' ? 'bg-success-bg border-success-border text-success'
                              : r === 'fail' ? 'bg-danger-bg  border-danger-border  text-danger'
                              :                'bg-bg-3       border-border-2        text-text-2'
                              : 'bg-transparent border-border-2 text-text-3 hover:border-border-3 hover:text-text'
                          )}>
                          {r === 'pass' ? '✓' : r === 'fail' ? '✕' : 'NA'}
                        </button>
                      ))}
                    </div>
                  )}

                  {isComplete && result && (
                    <Badge variant={result === 'pass' ? 'complete' : result === 'fail' ? 'rejected' : 'draft'}>
                      {result.toUpperCase()}
                    </Badge>
                  )}
                </div>

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
        <div className="flex justify-between items-center mt-4 gap-3">
          <p className="text-[12px] text-text-3">
            {answered}/{checkableItems.length} answered
            {answered < checkableItems.length && ` · ${checkableItems.length - answered} remaining`}
          </p>
          <Button variant="primary" size="lg" loading={completeInspection.isPending} onClick={handleCompleteClick}>
            {requiredItems.filter(i => results[i.id] == null).length > 0
              ? `Complete (${requiredItems.filter(i => results[i.id] == null).length} required remaining)`
              : 'Complete & Sign'}
          </Button>
        </div>
      )}

      {signatureDataUrl && (
        <div className="mt-3 flex items-center gap-3 p-3 bg-success-bg border border-success-border rounded-[8px]">
          <img src={signatureDataUrl} alt="Signature" className="h-10 border border-border rounded" />
          <p className="text-[12px] text-success">Signed by {user?.name}</p>
        </div>
      )}

      {showSignature && (
        <SignaturePad
          signerName={user?.name}
          onSave={handleSignatureApplied}
          onClose={() => setShowSignature(false)}
        />
      )}
    </AppLayout>
  )
}

// ── Completion summary screen ─────────────────────────────────────
function CompletionSummaryScreen({ summary: s, onBack }: { summary: CompletionSummary; onBack: () => void }) {
  const [maxLoading, setMaxLoading] = useState(false)
  const [maxPayload, setMaxPayload] = useState<string | null>(null)
  const [maxError,   setMaxError]   = useState<string | null>(null)
  const [copied,     setCopied]     = useState(false)
  const isPassed = s.overallResult === 'pass'

  const generateMaximo = async () => {
    setMaxLoading(true); setMaxError(null); setMaxPayload(null)
    try {
      const token = localStorage.getItem(JWT_KEY) ?? ''
      const res = await fetch('/api/ai/maximo-payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          woNumber: s.woNumber, assetName: s.assetName, location: s.location,
          wiNumber: s.wiNumber, wiTitle: s.wiTitle, overallResult: s.overallResult,
          completedAt: s.completedAt, inspectorName: s.inspectorName, failedItems: s.failedItems,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setMaxPayload(JSON.stringify(json.data, null, 2))
    } catch (err) {
      setMaxError(err instanceof Error ? err.message : 'Failed to generate payload')
    } finally { setMaxLoading(false) }
  }

  return (
    <AppLayout breadcrumb={[
      { label: 'Inspections', path: '/inspections' },
      { label: s.woNumber },
      { label: 'Completed' },
    ]}>
      {/* Result banner */}
      <div className={cn(
        'rounded-[12px] border p-6 mb-5 flex items-center gap-5',
        isPassed ? 'bg-success-bg border-success-border' : 'bg-danger-bg border-danger-border'
      )}>
        <div className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center text-2xl flex-shrink-0 font-bold',
          isPassed ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'
        )}>
          {isPassed ? '✓' : '✕'}
        </div>
        <div className="flex-1">
          <p className={cn('text-[18px] font-semibold', isPassed ? 'text-success' : 'text-danger')}>
            Inspection {isPassed ? 'PASSED' : 'FAILED'}
          </p>
          <p className="text-[12px] text-text-2 mt-0.5">
            {s.woNumber} · {s.assetName}{s.location ? ` · ${s.location}` : ''}
            {s.wiNumber ? ` · ${s.wiNumber}` : ''}
          </p>
          <p className="text-[11px] text-text-3 mt-0.5">
            {new Date(s.completedAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <img src={s.signatureDataUrl} alt="Signature" className="h-10 border border-border rounded bg-white px-2" />
          <div className="text-right">
            <p className="text-[11px] text-text-3">Signed by</p>
            <p className="text-[13px] font-medium text-text">{s.inspectorName}</p>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Total',   value: s.total,  color: 'text-text'    },
          { label: 'Passed',  value: s.passed, color: 'text-success' },
          { label: 'Failed',  value: s.failed, color: s.failed > 0 ? 'text-danger' : 'text-text-3' },
          { label: 'N/A',     value: s.na,     color: 'text-text-3'  },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-bg-2 border border-border rounded-[10px] px-4 py-4 text-center">
            <p className={cn('text-[28px] font-semibold font-mono leading-none', color)}>{value}</p>
            <p className="text-[11px] text-text-3 mt-1.5 uppercase tracking-[0.07em]">{label}</p>
          </div>
        ))}
      </div>

      {/* Failed items */}
      {s.failedItems.length > 0 && (
        <Card>
          <div className="px-[18px] py-3 border-b border-border flex items-center justify-between">
            <span className="text-[13px] font-semibold text-danger">Failed Items ({s.failedItems.length})</span>
            <span className="text-[11px] text-text-3">Action required</span>
          </div>
          {s.failedItems.map((item, i) => (
            <div key={i} className="flex items-start gap-3 px-[18px] py-3 border-b border-border last:border-0 bg-danger-bg/15">
              <span className="font-mono text-[11px] text-text-3 w-8 pt-0.5 flex-shrink-0">{item.item_no}</span>
              <div>
                <p className="text-[13px] text-text">{item.description}</p>
                {item.note && <p className="text-[12px] text-text-2 mt-0.5 italic">"{item.note}"</p>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Maximo payload */}
      <div className="mt-5 bg-bg-2 border border-border rounded-[12px] overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-text">IBM Maximo Work Order Payload</p>
            <p className="text-[11px] text-text-3 mt-0.5">AI-generated Maximo 7.6 REST API payload</p>
          </div>
          {!maxPayload
            ? <Button variant="secondary" loading={maxLoading} onClick={generateMaximo}>Generate Payload</Button>
            : <Button variant="secondary" onClick={() => {
                navigator.clipboard.writeText(maxPayload!).then(() => {
                  setCopied(true); setTimeout(() => setCopied(false), 2000)
                })
              }}>{copied ? '✓ Copied' : 'Copy JSON'}</Button>
          }
        </div>
        {!maxPayload && !maxLoading && !maxError && (
          <div className="px-5 py-6 text-center text-[12px] text-text-3">
            Generates a Maximo Work Order record with failure codes and remediation actions.
          </div>
        )}
        {maxLoading && (
          <div className="px-5 py-6 flex items-center justify-center gap-2 text-[12px] text-text-3">
            <span className="w-4 h-4 border border-accent border-t-transparent rounded-full animate-spin" />
            Generating via AI…
          </div>
        )}
        {maxError && <div className="px-5 py-4 text-[12px] text-danger">{maxError}</div>}
        {maxPayload && (
          <pre className="px-5 py-4 text-[11px] font-mono text-text-2 overflow-x-auto leading-relaxed max-h-[400px] overflow-y-auto">
            {maxPayload}
          </pre>
        )}
      </div>

      <div className="flex justify-between mt-5">
        <Button variant="secondary" onClick={onBack}>Back to Inspections</Button>
        <Button variant="primary" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
    </AppLayout>
  )
}
