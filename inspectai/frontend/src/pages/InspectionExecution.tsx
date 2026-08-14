import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Gauge,
  MapPin,
  ShieldCheck,
  Sparkles,
  Timer,
  Wrench,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { Card, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useAssignWorkInstruction, useWorkOrder } from '@/hooks/useWorkOrders'
import { useWorkInstructions } from '@/hooks/useWorkInstructions'
import {
  useInspectionRecord,
  useStartInspection,
  useRecordFinding,
  useAttachFindingPhoto,
  useCompleteInspection,
  type InspectionFinding,
} from '@/hooks/useInspection'
import { useAiAnalysis, useAiValidation, type AiValidation } from '@/hooks/useAiAnalysis'
import { useMomsWiSummary, type MomsWiSummary } from '@/hooks/useMomsWiSummary'
import { useToast } from '@/components/ui/Toast'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { useAuth } from '@/context/AuthContext'
import { useOffline } from '@/context/OfflineContext'
import { useAssignableUsers } from '@/hooks/useUsers'
import { JWT_KEY } from '@/lib/api'
import { cn } from '@/lib/cn'

type FindingResult = 'pass' | 'fail' | 'na'
type FieldType = 'pass_fail' | 'text' | 'number' | 'dropdown' | 'yes_no' |
                 'multiselect' | 'date' | 'measurement' | 'photo' | 'textarea' |
                 'signature' | 'heading' | 'table'

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
  layout_json?:        string | null
}

interface CompletionSummary {
  overallResult: FindingResult; passed: number; failed: number; na: number; total: number
  items: Array<{ item_no: string; description: string; result: FindingResult; note?: string }>
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
function PhotoAnalysisPanel({ itemDescription, acceptanceCriteria, assetName, location, onPhotoCaptured }: {
  itemDescription: string; acceptanceCriteria?: string | null
  assetName?: string; location?: string
  onPhotoCaptured?: (imageDataUrl: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ text: string; loading: boolean; error: string | null } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const analysePhoto = useCallback(async (file: File) => {
    setState({ text: '', loading: true, error: null })
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      setPreview(dataUrl)
      onPhotoCaptured?.(dataUrl)
      const base64 = dataUrl.split(',')[1]
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
      let streamDone = false
      while (!streamDone) {
        const { done, value } = await reader2.read()
        streamDone = done
        if (streamDone) break
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
  }, [itemDescription, acceptanceCriteria, assetName, location, onPhotoCaptured])

  return (
    <div className="mt-2">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) analysePhoto(f); e.target.value = '' }} />
      {!state && (
        <button onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-[8px] border border-border-2 bg-bg px-3 py-2 text-[12px] text-text-2 hover:border-accent hover:text-accent cursor-pointer transition-colors">
          <Camera size={14} />
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
function parseTableLayout(value?: string | null) {
  const fallback = { tableColumns: ['Item', 'Acceptance criteria', 'Result', 'Remarks'], tableRows: 4 }
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as Partial<typeof fallback>
    return {
      tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length
        ? parsed.tableColumns.map(String)
        : fallback.tableColumns,
      tableRows: typeof parsed.tableRows === 'number' ? Math.max(1, Math.min(20, parsed.tableRows)) : fallback.tableRows,
    }
  } catch {
    return fallback
  }
}

function FieldInput({
  item, value, onChange, onCommit, onResultChange,
}: {
  item: ChecklistItemRow
  value: string
  onChange: (v: string) => void
  onCommit?: (v: string) => void
  onResultChange?: (result: FindingResult, capturedValue: string) => void
}) {
  const type = item.field_type ?? 'pass_fail'
  const CLS  = 'w-full px-3 py-2 bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'

  if (type === 'text') {
    return (
      <input value={value} onChange={e => onChange(e.target.value)}
        onBlur={e => onCommit?.(e.target.value)}
        placeholder={item.placeholder ?? 'Enter text…'} className={CLS} />
    )
  }
  if (type === 'textarea') {
    return (
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
        onBlur={e => onCommit?.(e.target.value)}
        placeholder={item.placeholder ?? 'Enter notes…'} className={CLS + ' resize-none'} />
    )
  }
  if (type === 'table') {
    const layout = parseTableLayout(item.layout_json)
    let tableValue: string[][] = []
    try {
      tableValue = value ? JSON.parse(value) as string[][] : []
    } catch {
      tableValue = []
    }
    const updateCell = (row: number, col: number, nextValue: string) => {
      const next = Array.from({ length: layout.tableRows }, (_, r) =>
        Array.from({ length: layout.tableColumns.length }, (_, c) => tableValue[r]?.[c] ?? '')
      )
      next[row][col] = nextValue
      const serialized = JSON.stringify(next)
      onChange(serialized)
      return serialized
    }
    return (
      <div className="overflow-auto rounded-[8px] border border-border">
        <div className="grid min-w-[520px]" style={{ gridTemplateColumns: `repeat(${layout.tableColumns.length}, minmax(120px, 1fr))` }}>
          {layout.tableColumns.map((col, i) => (
            <div key={i} className="border-r border-border last:border-r-0 bg-bg-3 px-3 py-2 text-[11px] font-semibold text-text-2">
              {col}
            </div>
          ))}
        </div>
        {Array.from({ length: layout.tableRows }).map((_, row) => (
          <div key={row} className="grid min-w-[520px] border-t border-border" style={{ gridTemplateColumns: `repeat(${layout.tableColumns.length}, minmax(120px, 1fr))` }}>
            {layout.tableColumns.map((_, col) => (
              <input
                key={col}
                value={tableValue[row]?.[col] ?? ''}
                onChange={e => updateCell(row, col, e.target.value)}
                onBlur={e => onCommit?.(updateCell(row, col, e.target.value))}
                className="h-10 min-w-0 border-0 border-r border-border last:border-r-0 bg-bg px-3 text-[12px] text-text outline-none focus:bg-bg-2"
              />
            ))}
          </div>
        ))}
      </div>
    )
  }
  if (type === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          onBlur={e => onCommit?.(e.target.value)}
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
          onBlur={e => onCommit?.(e.target.value)}
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
      <select value={value} onChange={e => { onChange(e.target.value); onCommit?.(e.target.value) }} className={CLS}>
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
      const serialized = next.join(',')
      onChange(serialized)
      onCommit?.(serialized)
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
    return (
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onCommit?.(e.target.value)}
        className={CLS}
      />
    )
  }
  if (type === 'yes_no') {
    const select = (choice: 'yes' | 'no') => {
      const nextValue = value === choice ? '' : choice
      onChange(nextValue)
      onResultChange?.(choice === 'yes' ? 'pass' : 'fail', nextValue)
    }
    return (
      <div className="flex gap-2 mt-1">
        {[{ v: 'yes', label: 'Yes', cls: value === 'yes' ? 'bg-success-bg border-success-border text-success' : 'border-border-2 text-text-3 hover:border-success/50' },
          { v: 'no',  label: 'No',  cls: value === 'no'  ? 'bg-danger-bg border-danger-border text-danger'   : 'border-border-2 text-text-3 hover:border-danger/50' }].map(b => (
          <button key={b.v} onClick={() => select(b.v as 'yes' | 'no')}
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

function validationFromFinding(finding?: InspectionFinding): AiValidation | null {
  if (!finding?.ai_validation_status || !finding.ai_validation_reason) return null
  const evidencePayload = finding.ai_validation_evidence ?? {}
  return {
    status: finding.ai_validation_status,
    recommendedResult: finding.ai_validation_recommended_result ?? 'keep',
    confidence: Number(finding.ai_validation_confidence ?? 0),
    reason: finding.ai_validation_reason,
    evidence: evidencePayload.evidence ?? [],
    riskLevel: evidencePayload.riskLevel ?? 'low',
    requiredAction: evidencePayload.requiredAction ?? 'No additional action required.',
  }
}

// ── Main component ────────────────────────────────────────────────
function validationTone(status?: AiValidation['status']) {
  if (status === 'review_required') return 'bg-danger-bg border-danger-border text-danger'
  if (status === 'uncertain') return 'bg-warning-bg/20 border-warning-border text-warning'
  return 'bg-success-bg/20 border-success-border text-success'
}

function validationLabel(status?: AiValidation['status']) {
  if (status === 'review_required') return 'Human review required'
  if (status === 'uncertain') return 'Evidence needed'
  return 'Aligned'
}

function getResultTone(result?: FindingResult) {
  if (result === 'pass') return 'border-success-border bg-success-bg/25'
  if (result === 'fail') return 'border-danger-border bg-danger-bg/20'
  if (result === 'na') return 'border-border-2 bg-bg-3/70'
  return 'border-border bg-bg-2'
}

function usesResultButtons(fieldType?: FieldType | null) {
  return (fieldType ?? 'pass_fail') === 'pass_fail'
}

function valueResult(item: ChecklistItemRow, capturedValue: string): FindingResult {
  const type = item.field_type ?? 'pass_fail'
  if ((type === 'number' || type === 'measurement') && capturedValue.trim() !== '') {
    const numeric = Number(capturedValue)
    if (Number.isFinite(numeric)) {
      if (item.min_value != null && numeric < item.min_value) return 'fail'
      if (item.max_value != null && numeric > item.max_value) return 'fail'
    }
  }
  return 'pass'
}

function parseSignatureValue(value: string) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as { signerName?: string; signedAt?: string; signatureDataUrl?: string }
    return parsed.signatureDataUrl ? parsed : null
  } catch {
    return null
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function InspectionMetric({
  icon: Icon,
  label,
  value,
  tone = 'text-text',
}: {
  icon: typeof Activity
  label: string
  value: string | number
  tone?: string
}) {
  return (
    <div className="rounded-[8px] border border-border bg-bg-2 px-3 py-3">
      <div className="flex items-center gap-2 text-text-3">
        <Icon size={14} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em]">{label}</span>
      </div>
      <p className={cn('mt-2 font-mono text-[22px] font-semibold leading-none', tone)}>{value}</p>
    </div>
  )
}

export default function InspectionExecution() {
  const { id: workOrderDbId = '' } = useParams()
  const navigate = useNavigate()
  const { toast }    = useToast()
  const { user }     = useAuth()
  const { isOnline, enqueue } = useOffline()

  const { data: wo, isLoading: woLoading }      = useWorkOrder(workOrderDbId)
  const { data: record, isLoading: recLoading } = useInspectionRecord(workOrderDbId)
  const { data: availableWis = [] }             = useWorkInstructions()
  const { data: signerOptions = [] }            = useAssignableUsers()

  // Hoist WI number before any early returns (hook order must be constant)
  const wi       = (wo as any)?.work_instructions
  const wiNumber = wi?.wi_number as string | undefined

  // All hooks unconditional
  const startInspection    = useStartInspection()
  const recordFinding      = useRecordFinding()
  const attachPhoto        = useAttachFindingPhoto()
  const completeInspection = useCompleteInspection()
  const assignWI           = useAssignWorkInstruction()
  const { analyses, analyse, clear: clearAi } = useAiAnalysis()
  const { validations, validate: validateFinding, clear: clearValidation } = useAiValidation()
  const { data: momsData }                    = useMomsWiSummary(wiNumber)

  const [localResults,  setLocalResults]  = useState<Record<string, FindingResult>>({})
  const [localValues,   setLocalValues]   = useState<Record<string, string>>({})  // field input values → stored in notes
  const [localNotes,    setLocalNotes]    = useState<Record<string, string>>({})
  const [saving,        setSaving]        = useState<Record<string, boolean>>({})
  const [activeNote,    setActiveNote]    = useState<string | null>(null)
  const [selectedWIId,  setSelectedWIId]  = useState('')
  const [showSignature, setShowSignature] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [selectedSignerId, setSelectedSignerId] = useState(user?.id ?? '')
  const [itemSignatureTarget, setItemSignatureTarget] = useState<string | null>(null)
  const [itemSignerIds, setItemSignerIds] = useState<Record<string, string>>({})
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

  const recordHydrated = useRef<string | null>(null)
  useEffect(() => {
    if (!record?.id || recordHydrated.current === record.id) return
    const restoredNotes: Record<string, string> = {}
    for (const finding of record.inspection_findings ?? []) {
      if (finding.notes) restoredNotes[finding.checklist_item_id] = finding.notes
    }
    if (Object.keys(restoredNotes).length > 0) {
      setLocalNotes(prev => ({ ...restoredNotes, ...prev }))
    }
    recordHydrated.current = record.id
  }, [record])

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

  useEffect(() => {
    if (!selectedSignerId && user?.id) setSelectedSignerId(user.id)
  }, [selectedSignerId, user?.id])

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
  const hasLinkedChecklist = !!wi && checkableItems.length > 0
  const attachableWis = availableWis.filter(w => (w.checkableItemCount ?? w.checklistItemCount ?? 0) > 0)

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
  const pct      = checkableItems.length > 0 ? Math.round((answered / checkableItems.length) * 100) : 0
  const remaining = Math.max(0, checkableItems.length - answered)
  const requiredRemaining = requiredItems.filter(i => results[i.id] == null).length
  const riskTone = failed > 0
    ? 'border-danger-border bg-danger-bg/25 text-danger'
    : pct === 100
    ? 'border-success-border bg-success-bg/25 text-success'
    : 'border-accent-bd bg-accent-bg text-accent'
  const selectedSignerName = signerOptions.find(option => option.id === selectedSignerId)?.name ?? user?.name
  const signedByName = signerOptions.find(option => option.id === record?.signed_by)?.name ?? user?.name ?? '-'

  // ── Handlers ─────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      await startInspection.mutateAsync({ workOrderDbId, totalItems: checkableItems.length })
      toast('Inspection started', 'success')
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to start', 'error') }
  }

  const handleAttachChecklist = async () => {
    if (!selectedWIId) { toast('Select a work instruction checklist first', 'error'); return }
    try {
      await assignWI.mutateAsync({ dbId: workOrderDbId, workInstructionId: selectedWIId })
      toast('Checklist attached to work order', 'success')
      setSelectedWIId('')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to attach checklist', 'error')
    }
  }

  const handleResult = async (
    itemId: string,
    result: FindingResult,
    item: ChecklistItemRow,
    evidenceOverride?: { capturedValue?: string; inspectorNotes?: string },
  ) => {
    if (!record) return
    const next = results[itemId] === result ? undefined : result
    if (!next) {
      setLocalResults(prev => { const p = { ...prev }; delete p[itemId]; return p })
      clearAi(itemId)
      clearValidation(itemId)
      return
    }
    setLocalResults(prev => ({ ...prev, [itemId]: next }))
    setSaving(prev => ({ ...prev, [itemId]: true }))
    const capturedValue = evidenceOverride?.capturedValue ?? localValues[itemId]
    const inspectorNotes = evidenceOverride?.inspectorNotes ?? localNotes[itemId]
    const notesForItem = capturedValue
      ? `${capturedValue}${inspectorNotes ? '\n' + inspectorNotes : ''}`
      : inspectorNotes
    try {
      await recordFinding.mutateAsync({
        workOrderDbId,
        inspectionRecordId: record.id,
        checklistItemId:    itemId,
        result:             next,
        notes:              notesForItem,
      })
      const momsMatch = momsData?.topNokSteps.find(s =>
        s.step_desc && (
          s.step_desc.toLowerCase().includes(item.description.toLowerCase().slice(0, 40)) ||
          item.description.toLowerCase().includes((s.step_desc).toLowerCase().slice(0, 40))
        )
      )
      const validation = await validateFinding({
        itemId,
        inspectionRecordId: record.id,
        checklistItemId: item.id,
        selectedResult: next,
        itemDescription: item.description,
        acceptanceCriteria: item.acceptance_criteria ?? undefined,
        fieldType: item.field_type ?? 'pass_fail',
        required: item.required !== false,
        minValue: item.min_value ?? null,
        maxValue: item.max_value ?? null,
        capturedValue,
        inspectorNotes,
        assetName: woData.asset_name as string | undefined,
        location: woData.location as string | undefined,
        photoCount: record.inspection_findings?.find(f => f.checklist_item_id === item.id)?.photo_urls?.length ?? 0,
        momsHistoricalNokRate: momsMatch ? parseFloat(momsMatch.nok_rate) : momsData?.nokRate,
        momsHistoricalTotal: momsMatch ? parseInt(momsMatch.total) : momsData?.totalInspections,
      })
      if (validation?.status === 'review_required') {
        toast('AI review flagged this result for human review', 'error')
      } else if (validation?.status === 'uncertain') {
        toast('AI review needs more evidence for this result', 'info')
      }
      if (next === 'fail') {
        analyse({
          itemId,
          itemDescription:       item.description,
          acceptanceCriteria:    item.acceptance_criteria ?? undefined,
          fieldType:             item.field_type ?? 'pass_fail',
          selectedResult:        next,
          capturedValue,
          assetName:             woData.asset_name as string | undefined,
          location:              woData.location as string | undefined,
          inspectorNotes,
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
            notes:              notesForItem,
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

  const handleSaveValueEntry = async (item: ChecklistItemRow, capturedValue = localValues[item.id] ?? '') => {
    if (!capturedValue.trim()) {
      toast('Enter a value before saving this checklist item', 'error')
      return
    }
    await handleResult(item.id, valueResult(item, capturedValue), item, { capturedValue })
  }

  const handleItemSignatureApplied = async (dataUrl: string, signerId?: string) => {
    if (!itemSignatureTarget) return
    const item = checkableItems.find(i => i.id === itemSignatureTarget)
    if (!item) return
    const finalSignerId = signerId || itemSignerIds[item.id] || selectedSignerId || user?.id
    const signer = signerOptions.find(option => option.id === finalSignerId)
    const capturedValue = JSON.stringify({
      signerId: finalSignerId,
      signerName: signer?.name ?? user?.name ?? '-',
      signedAt: new Date().toISOString(),
      signatureDataUrl: dataUrl,
    })
    setLocalValues(prev => ({ ...prev, [item.id]: capturedValue }))
    setItemSignatureTarget(null)
    await handleResult(item.id, 'pass', item, { capturedValue })
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

  const handleSignatureApplied = async (dataUrl: string, signerId?: string) => {
    setSignatureDataUrl(dataUrl)
    setShowSignature(false)
    if (!record) return
    const finalSignerId = signerId || selectedSignerId || user?.id
    const signer = signerOptions.find(option => option.id === finalSignerId)
    const signerName = signer?.name ?? user?.name ?? '-'
    try {
      const completed = await completeInspection.mutateAsync({ inspectionRecordId: record.id, workOrderDbId, signatureDataUrl: dataUrl, signedBy: finalSignerId })
      localStorage.removeItem(draftKey(workOrderDbId))
      toast('Inspection completed and signed', 'success')
      setCompletionSummary({
        overallResult: completed.overallResult,
        passed: completed.passed, failed: completed.failed, na: completed.na, total: checkableItems.length,
        items: checkableItems.filter(i => results[i.id] != null).map(i => ({
          item_no: i.item_no,
          description: i.description,
          result: results[i.id],
          note: localNotes[i.id],
        })),
        failedItems: checkableItems.filter(i => results[i.id] === 'fail').map(i => ({
          item_no: i.item_no, description: i.description, note: localNotes[i.id],
        })),
        completedAt:      new Date().toISOString(),
        signatureDataUrl: dataUrl,
        inspectorName:    signerName,
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
  if (isComplete && record?.completed_at && record.signature_data_url) {
    const persistedSummary: CompletionSummary = {
      overallResult: record.overall_result ?? 'na',
      passed: record.passed_items,
      failed: record.failed_items,
      na: record.na_items,
      total: record.total_items || checkableItems.length,
      items: checkableItems.filter(i => results[i.id] != null).map(i => {
        const finding = record.inspection_findings?.find(f => f.checklist_item_id === i.id)
        return {
          item_no: i.item_no,
          description: i.description,
          result: results[i.id],
          note: localNotes[i.id] ?? finding?.notes ?? undefined,
        }
      }),
      failedItems: checkableItems.filter(i => results[i.id] === 'fail').map(i => {
        const finding = record.inspection_findings?.find(f => f.checklist_item_id === i.id)
        return {
          item_no: i.item_no,
          description: i.description,
          note: localNotes[i.id] ?? finding?.notes ?? undefined,
        }
      }),
      completedAt: record.completed_at,
      signatureDataUrl: record.signature_data_url,
      inspectorName: signedByName,
      woNumber: (woData.wo_number as string) ?? '',
      assetName: (woData.asset_name as string) ?? '',
      wiNumber: wi?.wi_number ?? '',
      wiTitle: wi?.title ?? '',
      location: (woData.location as string) ?? '',
    }
    return <CompletionSummaryScreen summary={persistedSummary} onBack={() => navigate('/inspections')} />
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
      <div className="relative mb-5 overflow-hidden rounded-[12px] border border-border bg-bg-2">
        <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-[8px] border border-accent-bd bg-accent-bg px-2.5 py-1 font-mono text-[12px] text-accent">
              <ClipboardCheck size={14} /> {woData.wo_number as string}
            </span>
            <Badge variant={(woData.status as string) === 'complete' ? 'complete' : 'open'}>
              {String(woData.status ?? '').replace('_', ' ')}
            </Badge>
            <span className={cn('inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1 text-[11px] font-medium', riskTone)}>
              <ShieldCheck size={13} />
              {failed > 0 ? `${failed} exception${failed === 1 ? '' : 's'}` : pct === 100 ? 'Ready for sign-off' : 'Inspection in progress'}
            </span>
          </div>
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-[-0.3px] text-text">{woData.asset_name as string}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-2">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} className="text-text-3" /> {(woData.location as string) || 'No location'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileCheck2 size={14} className="text-text-3" /> {wi?.wi_number ?? 'No WI'}{wi?.revision ? ` / ${wi.revision}` : ''}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Wrench size={14} className="text-text-3" />
              <span className="truncate">{wi?.title ?? 'Checklist not assigned'}</span>
            </span>
          </div>
          <p className="hidden">
            {woData.location as string} · {wi?.title ?? 'Checklist not assigned'}{wi?.revision ? ` · ${wi.revision}` : ''}
          </p>
        </div>
        <div className="grid grid-cols-[88px_1fr] items-center gap-4 rounded-[10px] border border-border bg-bg px-4 py-3">
          <ProgressRing pct={pct} />
          <div className="grid grid-cols-2 gap-2">
            <InspectionMetric icon={Gauge} label="Answered" value={`${answered}/${checkableItems.length}`} />
            <InspectionMetric icon={CheckCircle2} label="Pass" value={passed} tone="text-success" />
            <InspectionMetric icon={AlertTriangle} label="Fail" value={failed} tone={failed > 0 ? 'text-danger' : 'text-text-3'} />
            <InspectionMetric icon={Timer} label="Elapsed" value={isStarted && !isComplete ? timerLabel : '--'} tone="text-accent" />
          </div>
        </div>
        </div>
      </div>

      {isStarted && <ProgressBar />}

      {isStarted && !isComplete && (
        <div className="sticky top-4 z-10 mb-5 rounded-[10px] border border-border bg-bg/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-[8px] border border-border-2 bg-bg-2 px-3 py-2 text-[12px] text-text-2">
                <Clock3 size={14} className="text-accent" /> {timerLabel}
              </span>
              <span className="inline-flex items-center gap-2 rounded-[8px] border border-border-2 bg-bg-2 px-3 py-2 text-[12px] text-text-2">
                <Gauge size={14} className="text-accent" /> {remaining} item{remaining === 1 ? '' : 's'} remaining
              </span>
              {failed > 0 && (
                <span className="inline-flex items-center gap-2 rounded-[8px] border border-danger-border bg-danger-bg/25 px-3 py-2 text-[12px] text-danger">
                  <AlertTriangle size={14} /> Review {failed} exception{failed === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <Button variant="primary" loading={completeInspection.isPending} onClick={handleCompleteClick}>
              {requiredRemaining > 0 ? `${requiredRemaining} required remaining` : 'Complete & Sign'}
            </Button>
          </div>
        </div>
      )}

      {/* MOMS historical context */}
      {momsData && <MomsBanner data={momsData} />}

      {/* Not started */}
      {!isStarted && (
        <Card>
          <CardBody className="grid gap-6 p-6 md:grid-cols-[1fr_320px] md:items-center">
            <div>
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[10px] border border-accent-bd bg-accent-bg text-accent">
                <ClipboardCheck size={24} />
              </div>
              <h2 className="text-[20px] font-semibold tracking-[-0.2px] text-text">Ready to start inspection</h2>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-text-2">
              This inspection has not been started yet.<br />
              {hasLinkedChecklist ? (
                <>
                  {checkableItems.length} checklist items from{' '}
                  <span className="text-text font-mono">{wi?.wi_number}</span>.
                </>
              ) : (
                'No inspection checklist is attached to this work order.'
              )}
            </p>
              <div className="mt-5 grid max-w-xl grid-cols-3 gap-3">
                <InspectionMetric icon={FileCheck2} label="Checklist" value={checkableItems.length} />
                <InspectionMetric icon={Sparkles} label="AI review" value={hasLinkedChecklist ? 'On' : '--'} tone="text-accent" />
                <InspectionMetric icon={Camera} label="Evidence" value="Photo" tone="text-text-2" />
              </div>
            </div>
            {!hasLinkedChecklist ? (
              <div className="w-full flex flex-col gap-3 rounded-[10px] border border-warning-border bg-warning-bg/15 p-4">
                <p className="text-[13px] text-warning">Attach a work instruction with checklist items before starting.</p>
                <select
                  value={selectedWIId}
                  onChange={e => setSelectedWIId(e.target.value)}
                  className="w-full px-3 py-2 bg-bg border border-border-2 rounded-[8px] text-[13px] text-text outline-none focus:border-accent"
                >
                  <option value="">Select checklist...</option>
                  {attachableWis.map(w => {
                    const count = w.checkableItemCount ?? w.checklistItemCount ?? 0
                    return (
                      <option key={w.dbId} value={w.dbId}>
                        {w.id} - {w.title} ({count} item{count === 1 ? '' : 's'})
                      </option>
                    )
                  })}
                </select>
                <Button variant="primary" loading={assignWI.isPending} disabled={attachableWis.length === 0} onClick={handleAttachChecklist}>
                  Attach Checklist
                </Button>
              </div>
            ) : (
              <div className="rounded-[10px] border border-border bg-bg-2 p-4">
                <p className="mb-3 text-[12px] leading-relaxed text-text-2">
                  Start creates the inspection record, enables offline draft saving, and opens AI result review for every checklist response.
                </p>
                <Button variant="primary" size="lg" loading={startInspection.isPending} onClick={handleStart} className="w-full">
                  <ClipboardCheck size={16} /> Start Inspection
                </Button>
              </div>
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
          <div className="px-[18px] py-4 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-bg-2">
            <span className="text-[13px] font-semibold">Checklist — {wi?.title}</span>
            <span className="text-[11px] text-text-3 font-mono">{wi?.revision}</span>
          </div>

          {items.map(item => {
            const ft       = item.field_type ?? 'pass_fail'
            const result   = results[item.id]
            const isSaving = saving[item.id]
            const showNote = activeNote === item.id
            const ai       = analyses[item.id]
            const finding  = record?.inspection_findings?.find(f => f.checklist_item_id === item.id)
            const validation = validations[item.id]?.data ?? validationFromFinding(finding)
            const validationLoading = validations[item.id]?.loading
            const validationError = validations[item.id]?.error
            const fieldVal = localValues[item.id] ?? ''
            const signatureValue = ft === 'signature' ? parseSignatureValue(fieldVal || finding?.notes || '') : null

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
                  getResultTone(result)
                )}>
                <div className="flex items-start gap-4 px-[18px] py-4">
                  <span className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] border font-mono text-[11px]',
                    result === 'pass' ? 'border-success-border bg-success-bg text-success' :
                    result === 'fail' ? 'border-danger-border bg-danger-bg text-danger' :
                    'border-border-2 bg-bg text-text-3'
                  )}>{item.item_no}</span>

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

                    {/* Field-type specific input */}
                    {!isComplete && ft === 'signature' && (
                      <div className="mb-3 rounded-[8px] border border-border-2 bg-bg p-3">
                        <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.07em] text-text-2">
                          Signer
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <select
                            value={itemSignerIds[item.id] ?? selectedSignerId}
                            onChange={e => setItemSignerIds(prev => ({ ...prev, [item.id]: e.target.value }))}
                            className="min-w-0 flex-1 rounded-[8px] border border-border-2 bg-bg px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
                          >
                            <option value="">Select signer...</option>
                            {signerOptions.map(option => (
                              <option key={option.id} value={option.id}>
                                {option.name}{option.staffId ? ` (${option.staffId})` : ''}{option.role ? ` - ${option.role}` : ''}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="primary"
                            disabled={!(itemSignerIds[item.id] ?? selectedSignerId)}
                            onClick={() => setItemSignatureTarget(item.id)}
                          >
                            Sign Item
                          </Button>
                        </div>
                        {signatureValue && (
                          <div className="mt-3 rounded-[8px] border border-success-border bg-success-bg/20 p-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <img src={signatureValue.signatureDataUrl} alt="Signature" className="h-14 rounded border border-border bg-white px-2" />
                              <div>
                                <p className="text-[12px] font-medium text-success">Signed by {signatureValue.signerName ?? 'selected signer'}</p>
                                <p className="mt-0.5 font-mono text-[11px] text-text-3">
                                  {signatureValue.signedAt ? new Date(signatureValue.signedAt).toLocaleString('en-SG') : ''}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {!isComplete && ft !== 'signature' && !['pass_fail'].includes(ft) && (
                      <div className="mb-3">
                        <FieldInput item={item} value={fieldVal}
                          onChange={v => setLocalValues(prev => ({ ...prev, [item.id]: v }))}
                          onCommit={v => { if (v.trim()) void handleSaveValueEntry(item, v) }}
                          onResultChange={(nextResult, capturedValue) => handleResult(item.id, nextResult, item, { capturedValue })} />
                      </div>
                    )}

                    {/* AI suggestion */}
                    {(ai?.text || ai?.loading || ai?.error) && (
                      <div className="mt-3 p-3 bg-accent-bg border border-accent-bd rounded-[8px]">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-semibold text-accent uppercase tracking-[0.08em]">AI suggestion</span>
                          {ai.loading && <span className="w-3 h-3 border border-accent border-t-transparent rounded-full animate-spin" />}
                        </div>
                        {ai.error
                          ? <p className="text-[12px] text-danger">{ai.error}</p>
                          : <pre className="text-[12px] text-text leading-relaxed whitespace-pre-wrap font-sans">
                              {ai.text}{ai.loading && <span className="animate-pulse">|</span>}
                            </pre>
                        }
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
                          onPhotoCaptured={(imageDataUrl) => {
                            if (!record) return
                            attachPhoto.mutate({
                              workOrderDbId,
                              inspectionRecordId: record.id,
                              checklistItemId: item.id,
                              imageDataUrl,
                            }, {
                              onSuccess: () => toast('Photo evidence saved', 'success'),
                              onError: (err) => {
                                if (!isOnline) {
                                  enqueue({
                                    endpoint: `/inspections/${workOrderDbId}/findings/photo`,
                                    method: 'POST',
                                    body: {
                                      inspectionRecordId: record.id,
                                      checklistItemId: item.id,
                                      imageDataUrl,
                                    },
                                    label: `${item.item_no} - photo evidence`,
                                  })
                                  toast('Offline - photo queued for sync', 'info')
                                } else {
                                  toast(err instanceof Error ? err.message : 'Photo save failed', 'error')
                                }
                              },
                            })
                          }}
                        />
                      </>
                    )}

                    {/* AI result validation */}
                    {(validation || validationLoading || validationError) && (
                      <div className={cn(
                        'mt-3 p-3 border rounded-[8px]',
                        validationError ? 'bg-danger-bg border-danger-border text-danger' : validationTone(validation?.status)
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">AI Result Review</span>
                          {validationLoading && <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />}
                          {validation && (
                            <span className="ml-auto text-[10px] font-mono opacity-75">
                              {Math.round(validation.confidence * 100)}%
                            </span>
                          )}
                        </div>
                        {validationError ? (
                          <p className="text-[12px]">{validationError}</p>
                        ) : validation ? (
                          <div className="text-[12px] leading-relaxed text-text">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={cn(
                                'px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-[0.06em]',
                                validationTone(validation.status)
                              )}>
                                {validationLabel(validation.status)}
                              </span>
                              {validation.recommendedResult !== 'keep' && (
                                <span className="text-[11px] text-text-2">
                                  Recommended: {validation.recommendedResult.toUpperCase()}
                                </span>
                              )}
                            </div>
                            <p>{validation.reason}</p>
                            {validation.evidence.length > 0 && (
                              <ul className="mt-1 list-disc pl-4 text-text-2">
                                {validation.evidence.slice(0, 3).map((evidence, i) => (
                                  <li key={i}>{evidence}</li>
                                ))}
                              </ul>
                            )}
                            {validation.requiredAction && (
                              <p className="mt-1 text-text-2">{validation.requiredAction}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[12px] text-text-2">Checking result consistency...</p>
                        )}
                      </div>
                    )}

                    {/* AI analysis */}
                    {false && (ai?.text || ai?.loading || ai?.error) && (
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
                  {!isComplete && usesResultButtons(ft) && (
                    <div className="flex flex-col gap-1.5 flex-shrink-0 pt-0.5">
                      {((ft === 'yes_no' ? ['na'] : ['pass', 'fail', 'na']) as FindingResult[]).map(r => (
                        <button key={r}
                          disabled={isSaving}
                          onClick={() => handleResult(item.id, r, item)}
                          className={cn(
                            'w-11 h-11 rounded-[9px] border text-[12px] font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-40 active:scale-[0.96]',
                            result === r
                              ? r === 'pass' ? 'bg-success text-white border-success'
                              : r === 'fail' ? 'bg-danger text-white border-danger'
                              :                'bg-bg-3 border-border-2 text-text'
                              : 'bg-bg border-border-2 text-text-3 hover:border-accent hover:text-text'
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
          <p className="text-[12px] text-success">Signed by {selectedSignerName}</p>
        </div>
      )}

      {showSignature && (
        <SignaturePad
          signerName={user?.name}
          signerOptions={signerOptions}
          selectedSignerId={selectedSignerId}
          onSignerChange={setSelectedSignerId}
          requireSigner
          onSave={handleSignatureApplied}
          onClose={() => setShowSignature(false)}
        />
      )}

      {itemSignatureTarget && (
        <SignaturePad
          signerOptions={signerOptions}
          selectedSignerId={itemSignerIds[itemSignatureTarget] ?? selectedSignerId}
          onSignerChange={signerId => setItemSignerIds(prev => ({ ...prev, [itemSignatureTarget]: signerId }))}
          requireSigner
          onSave={handleItemSignatureApplied}
          onClose={() => setItemSignatureTarget(null)}
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

  const printReport = () => {
    const win = window.open('about:blank', '_blank', 'width=900,height=1100')
    if (!win) return
    const completedAt = new Date(s.completedAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
    const generatedAt = new Date().toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
    const passRate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0
    const allRows = s.items.length
      ? s.items.map(item => `
          <tr>
            <td class="mono item-no">${escapeHtml(item.item_no)}</td>
            <td>
              <div class="item-title">${escapeHtml(item.description)}</div>
              ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : ''}
            </td>
            <td class="center"><span class="result ${item.result}">${escapeHtml(item.result.toUpperCase())}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="3" class="muted center">No checklist results recorded.</td></tr>'
    const failedRows = s.failedItems.length
      ? s.failedItems.map(item => `
          <tr>
            <td class="mono item-no">${escapeHtml(item.item_no)}</td>
            <td>
              <div class="item-title">${escapeHtml(item.description)}</div>
              ${item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : '<div class="item-note muted">No additional note recorded.</div>'}
            </td>
          </tr>
        `).join('')
      : '<tr><td colspan="2" class="muted center">No failed items recorded.</td></tr>'
    win.document.open()
    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(s.woNumber)} Inspection Report</title>
          <style>
            * { box-sizing: border-box; }
            :root {
              --ink: #111827;
              --muted: #64748b;
              --line: #dbe3ef;
              --paper: #ffffff;
              --soft: #f6f8fb;
              --brand: #1d4ed8;
              --brand-2: #0f766e;
              --danger: #b91c1c;
              --success: #047857;
            }
            body {
              margin: 0;
              padding: 28px;
              font-family: Inter, "Segoe UI", Arial, sans-serif;
              color: var(--ink);
              background: #eef2f7;
            }
            .report {
              max-width: 920px;
              margin: 0 auto;
              background: var(--paper);
              border: 1px solid var(--line);
              box-shadow: 0 24px 70px rgba(15, 23, 42, .14);
            }
            .cover {
              position: relative;
              overflow: hidden;
              padding: 34px 38px 30px;
              color: #fff;
              background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 58%, #0f766e 100%);
            }
            .cover:after {
              content: "";
              position: absolute;
              right: -110px;
              top: -130px;
              width: 360px;
              height: 360px;
              border-radius: 50%;
              background: rgba(255,255,255,.12);
            }
            .brand-row { position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 28px; }
            .brand { display: flex; align-items: center; gap: 12px; }
            .mark { width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.26); display: grid; place-items: center; font-weight: 800; letter-spacing: -.04em; }
            .brand-name { font-size: 12px; opacity: .82; text-transform: uppercase; letter-spacing: .16em; }
            .doc-type { margin-top: 2px; font-size: 18px; font-weight: 750; }
            .doc-meta { text-align: right; font-size: 11px; opacity: .78; line-height: 1.7; }
            .hero { position: relative; z-index: 1; margin-top: 34px; display: grid; grid-template-columns: 1fr auto; gap: 28px; align-items: end; }
            h1 { margin: 0; font-size: 31px; line-height: 1.06; letter-spacing: -.03em; }
            .subtitle { margin-top: 10px; color: rgba(255,255,255,.78); font-size: 13px; line-height: 1.5; }
            .status-card { min-width: 190px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.12); border-radius: 14px; padding: 16px; backdrop-filter: blur(8px); }
            .status-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; opacity: .72; }
            .status-card .value { margin-top: 7px; font-size: 22px; font-weight: 800; }
            .status-card .rate { margin-top: 9px; height: 7px; border-radius: 999px; background: rgba(255,255,255,.22); overflow: hidden; }
            .status-card .rate span { display:block; height: 100%; background: #fff; width: ${passRate}%; }
            .content { padding: 28px 38px 36px; }
            .muted { color: var(--muted); }
            .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
            .center { text-align: center; }
            .status-pill { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 7px 11px; font-weight: 800; font-size: 11px; letter-spacing: .06em; }
            .status-pill.pass { background: #dcfce7; color: #166534; }
            .status-pill.fail { background: #fee2e2; color: #991b1b; }
            .section { margin-top: 24px; }
            .section-title { display:flex; align-items:center; justify-content:space-between; gap: 16px; margin-bottom: 11px; }
            .section-title h2 { margin:0; font-size: 15px; letter-spacing: -.01em; }
            .section-title span { color: var(--muted); font-size: 11px; }
            .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 22px; }
            .info-card { border: 1px solid var(--line); border-radius: 12px; padding: 13px 14px; background: linear-gradient(180deg, #fff, #f8fafc); min-height: 76px; }
            .info-card b { display:block; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .12em; margin-bottom: 7px; }
            .info-card div { font-size: 12px; line-height: 1.35; font-weight: 650; }
            .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 22px; }
            .kpi { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; padding: 16px 15px; background: var(--soft); }
            .kpi:before { content:""; position:absolute; inset:0 auto 0 0; width: 4px; background: var(--brand); }
            .kpi.pass:before { background: var(--success); }
            .kpi.fail:before { background: var(--danger); }
            .kpi strong { display:block; font-size: 30px; line-height: 1; letter-spacing: -.04em; }
            .kpi span { display:block; margin-top: 7px; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .12em; }
            .narrative { border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; background: #fbfdff; font-size: 12.5px; line-height: 1.55; }
            table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11.5px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
            th, td { padding: 10px 11px; vertical-align: top; text-align: left; border-bottom: 1px solid var(--line); }
            tr:last-child td { border-bottom: 0; }
            th { background: #f1f5f9; color: #475569; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
            tbody tr:nth-child(even) td { background: #fbfdff; }
            .item-no { width: 72px; color: #475569; font-weight: 700; }
            .item-title { font-weight: 650; line-height: 1.35; }
            .item-note { margin-top: 5px; color: #64748b; font-size: 10.5px; line-height: 1.4; }
            .result { display: inline-block; min-width: 52px; text-align: center; border-radius: 999px; padding: 4px 9px; font-weight: 800; font-size: 9.5px; letter-spacing: .06em; }
            .result.pass { background: #dcfce7; color: #166534; }
            .result.fail { background: #fee2e2; color: #991b1b; }
            .result.na { background: #f1f5f9; color: #475569; }
            .exception-panel { border: 1px solid ${s.failed > 0 ? '#fecaca' : '#bbf7d0'}; border-radius: 14px; overflow:hidden; }
            .exception-panel .panel-head { padding: 13px 15px; background: ${s.failed > 0 ? '#fff1f2' : '#f0fdf4'}; display:flex; justify-content:space-between; align-items:center; }
            .exception-panel .panel-head strong { color: ${s.failed > 0 ? '#b91c1c' : '#047857'}; }
            .signature { margin-top: 28px; display: grid; grid-template-columns: 1fr 310px; gap: 24px; align-items: end; }
            .assurance { border: 1px solid var(--line); border-radius: 12px; padding: 14px; color: var(--muted); font-size: 11px; line-height: 1.5; background: #f8fafc; }
            .signature-box { border: 1px solid var(--line); border-radius: 12px; padding: 14px; text-align: right; background: #fff; }
            .signature img { max-height: 74px; max-width: 260px; display: block; margin-left: auto; margin-bottom: 10px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 4px 10px; }
            .footer { margin-top: 26px; border-top: 1px solid var(--line); padding-top: 13px; display:flex; justify-content:space-between; gap: 18px; color: var(--muted); font-size: 10.5px; }
            .actions { margin: 16px auto 0; max-width: 920px; color: #6b7280; font-size: 11px; text-align: center; }
            @media print {
              @page { size: A4; margin: 12mm; }
              body { padding: 0; background: #fff; }
              .report { max-width: none; border: 0; box-shadow: none; }
              .cover { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
              .section, .signature { break-inside: avoid; }
              .actions { display: none; }
            }
          </style>
        </head>
        <body>
          <main class="report">
            <section class="cover">
              <div class="brand-row">
                <div class="brand">
                  <div class="mark">IA</div>
                  <div>
                    <div class="brand-name">InspectionAI</div>
                    <div class="doc-type">Inspection Completion Report</div>
                  </div>
                </div>
                <div class="doc-meta">
                  <div>Report generated ${escapeHtml(generatedAt)}</div>
                  <div class="mono">${escapeHtml(s.woNumber)}</div>
                </div>
              </div>
              <div class="hero">
                <div>
                  <h1>${escapeHtml(s.assetName)}</h1>
                  <div class="subtitle">${escapeHtml(s.location || 'No location recorded')} &middot; ${escapeHtml(s.wiTitle || 'No work instruction title')}</div>
                </div>
                <div class="status-card">
                  <div class="label">Overall Result</div>
                  <div class="value">${s.overallResult === 'pass' ? 'PASSED' : 'FAILED'}</div>
                  <div class="label" style="margin-top:8px;">Pass Rate ${passRate}%</div>
                  <div class="rate"><span></span></div>
                </div>
              </div>
            </section>
            <div class="content">
              <section class="meta">
                <div class="info-card"><b>Work Order</b><div class="mono">${escapeHtml(s.woNumber)}</div></div>
                <div class="info-card"><b>Completed</b><div>${escapeHtml(completedAt)}</div></div>
                <div class="info-card"><b>Work Instruction</b><div class="mono">${escapeHtml(s.wiNumber || '-')}</div></div>
                <div class="info-card"><b>Location</b><div>${escapeHtml(s.location || '-')}</div></div>
              </section>
              <section class="kpis">
                <div class="kpi"><strong>${s.total}</strong><span>Total Items</span></div>
                <div class="kpi pass"><strong>${s.passed}</strong><span>Passed</span></div>
                <div class="kpi fail"><strong>${s.failed}</strong><span>Failed</span></div>
                <div class="kpi"><strong>${s.na}</strong><span>N/A</span></div>
              </section>
              <section class="section">
                <div class="section-title"><h2>Executive Summary</h2><span class="status-pill ${s.overallResult === 'pass' ? 'pass' : 'fail'}">${s.overallResult === 'pass' ? 'PASSED' : 'FAILED'}</span></div>
                <div class="narrative">
                  Inspection ${escapeHtml(s.woNumber)} was completed for <strong>${escapeHtml(s.assetName)}</strong> using
                  <strong>${escapeHtml(s.wiNumber || 'the assigned work instruction')}</strong>. The inspection recorded
                  <strong>${s.passed}</strong> passed item${s.passed === 1 ? '' : 's'}, <strong>${s.failed}</strong> failed item${s.failed === 1 ? '' : 's'},
                  and <strong>${s.na}</strong> item${s.na === 1 ? '' : 's'} marked N/A.
                </div>
              </section>
              <section class="section exception-panel">
                <div class="panel-head">
                  <strong>${s.failed > 0 ? `Exceptions Requiring Attention (${s.failedItems.length})` : 'No Exceptions Recorded'}</strong>
                  <span class="muted">${s.failed > 0 ? 'Review and corrective action required' : 'No failed checklist items'}</span>
                </div>
                <table style="border:0;border-radius:0;margin-top:0;">
                  <thead><tr><th style="width:80px;">Item</th><th>Description and Notes</th></tr></thead>
                  <tbody>${failedRows}</tbody>
                </table>
              </section>
              <section class="section">
                <div class="section-title"><h2>Checklist Results Register</h2><span>${s.items.length} recorded result${s.items.length === 1 ? '' : 's'}</span></div>
                <table>
                  <thead><tr><th style="width:80px;">Item</th><th>Description and Evidence Notes</th><th style="width:90px;text-align:center;">Result</th></tr></thead>
                  <tbody>${allRows}</tbody>
                </table>
              </section>
              <section class="signature">
                <div class="assurance">
                  This report was generated from the InspectionAI electronic inspection record. The signature shown confirms inspection completion and sign-off by the listed person at the recorded completion time.
                </div>
                <div class="signature-box">
                  <img src="${s.signatureDataUrl}" alt="Signature" />
                  <strong>${escapeHtml(s.inspectorName)}</strong>
                  <div class="muted">Electronic signature</div>
                </div>
              </section>
              <section class="footer">
                <div>InspectionAI &middot; Controlled inspection record</div>
                <div class="mono">${escapeHtml(s.woNumber)} &middot; ${escapeHtml(generatedAt)}</div>
              </section>
            </div>
          </main>
          <p class="actions">Use your browser print dialog and choose "Save as PDF".</p>
          <script>
            window.onload = () => {
              window.focus();
              setTimeout(() => window.print(), 250);
            };
          </script>
        </body>
      </html>
    `)
    win.document.close()
  }

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

      <Card className="mt-5">
        <div className="px-[18px] py-3 border-b border-border flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text">Checklist Results ({s.items.length})</span>
          <span className="text-[11px] text-text-3">All recorded items</span>
        </div>
        {s.items.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-text-3">No checklist results recorded.</div>
        ) : (
          s.items.map((item, i) => (
            <div key={`${item.item_no}-${i}`} className="flex items-start gap-3 px-[18px] py-3 border-b border-border last:border-0">
              <span className="font-mono text-[11px] text-text-3 w-10 pt-0.5 flex-shrink-0">{item.item_no}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-text">{item.description}</p>
                {item.note && <p className="text-[12px] text-text-2 mt-0.5 italic">"{item.note}"</p>}
              </div>
              <Badge variant={item.result === 'pass' ? 'complete' : item.result === 'fail' ? 'rejected' : 'draft'}>
                {item.result.toUpperCase()}
              </Badge>
            </div>
          ))
        )}
      </Card>

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
        <Button variant="primary" onClick={printReport}>Print / Save PDF</Button>
      </div>
    </AppLayout>
  )
}
