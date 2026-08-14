import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { type LucideIcon, GripVertical, Trash2, Copy, Eye, ArrowLeft, X, Upload,
         CheckSquare, Type, Hash, ChevronDown, ToggleLeft, Calendar,
         Ruler, Camera, AlignLeft, PenLine, AlignJustify,
         CheckCheck, AlertCircle, Zap, Settings2, Table2, FileSpreadsheet } from 'lucide-react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useSaveWIWithItems, useSubmitForApproval, useWIBuilderData } from '@/hooks/useWorkInstructions'
import { useApprovers } from '@/hooks/useUsers'
import { ImportPdfModal } from '@/components/ui/ImportPdfModal'
import { ImportExcelModal } from '@/components/ui/ImportExcelModal'
import { cn } from '@/lib/cn'

// ── Field types ──────────────────────────────────────────────────
export type FieldType =
  | 'pass_fail' | 'text' | 'number' | 'dropdown' | 'yes_no'
  | 'multiselect' | 'date' | 'measurement' | 'photo' | 'textarea'
  | 'signature' | 'heading' | 'table'

type FieldWidth = 'full' | 'half' | 'third'
type DragPlacement = 'before' | 'after' | 'beside'

interface WIFieldLayout {
  width: FieldWidth
  height: number
  sectionLevel: 1 | 2 | 3
  tableColumns: string[]
  tableRows: number
  rowBreakBefore: boolean
}

export interface WIField {
  id:                 string
  type:               FieldType
  label:              string
  acceptanceCriteria: string
  required:           boolean
  placeholder:        string
  optionsText:        string   // newline-separated, for dropdown/multiselect
  unit:               string
  minValue:           string
  maxValue:           string
  conditional: { fieldId: string; operator: 'equals' | 'not_equals' | 'contains'; value: string } | null
  sourcePage:         number | null
  sourceText:         string
  aiConfidence:       number | null
  aiWarnings:         string[]
  layout:             WIFieldLayout
}

interface WIMeta {
  wiNumber:      string
  title:         string
  category:      string
  revision:      string
  effectiveDate: string
  expiryDate:    string
}

interface StarterTemplate {
  id: string
  name: string
  desc: string
  items: Array<Partial<WIField> & Pick<WIField, 'type' | 'label'>>
}

interface QualityIssue {
  level: 'error' | 'warning'
  message: string
}

// ── Field palette definition ─────────────────────────────────────
const PALETTE: { type: FieldType; label: string; desc: string; Icon: LucideIcon }[] = [
  { type: 'pass_fail',   label: 'Pass / Fail / NA', desc: 'Inspector marks result',    Icon: CheckSquare  },
  { type: 'text',        label: 'Text input',        desc: 'Free text answer',          Icon: Type         },
  { type: 'number',      label: 'Number',            desc: 'Numeric with min/max',      Icon: Hash         },
  { type: 'dropdown',    label: 'Dropdown',          desc: 'Select from options',       Icon: ChevronDown  },
  { type: 'yes_no',      label: 'Yes / No',          desc: 'Boolean toggle',            Icon: ToggleLeft   },
  { type: 'multiselect', label: 'Multi-select',      desc: 'Multiple choices',          Icon: CheckCheck   },
  { type: 'date',        label: 'Date / Time',        desc: 'Date picker',               Icon: Calendar     },
  { type: 'measurement', label: 'Measurement',        desc: 'Value + unit',              Icon: Ruler        },
  { type: 'photo',       label: 'Photo capture',      desc: 'Camera capture',            Icon: Camera       },
  { type: 'textarea',    label: 'Long text',          desc: 'Multi-line notes',          Icon: AlignLeft    },
  { type: 'signature',   label: 'Signature',          desc: 'Sign pad',                  Icon: PenLine      },
  { type: 'heading',     label: 'Section heading',    desc: 'Visual divider / grouper',  Icon: AlignJustify },
  { type: 'table',       label: 'Table',              desc: 'Rows, columns, dimensions', Icon: Table2       },
]

const TYPE_LABEL: Record<FieldType, string> = {
  pass_fail: 'pass/fail', text: 'text', number: 'number', dropdown: 'dropdown',
  yes_no: 'yes/no', multiselect: 'multi', date: 'date', measurement: 'measure',
  photo: 'photo', textarea: 'long text', signature: 'signature', heading: 'heading',
  table: 'table',
}

const UNITS = ['mm','cm','m','kg','kN','A','V','Ω','bar','PSI','°C','°F','%','rpm','Hz']

function makeField(type: FieldType, sortOrder: number): WIField {
  const defaultLabel: Record<FieldType, string> = {
    pass_fail:   'Inspection item', text: 'Enter text',
    number:      'Enter value', dropdown: 'Select option',
    yes_no:      'Yes or No', multiselect: 'Select all that apply',
    date:        'Enter date', measurement: 'Measurement',
    photo:       'Attach photo', textarea: 'Additional notes',
    signature:   'Inspector signature', heading: 'Section',
    table:       'Inspection table',
  }
  return {
    id:                 crypto.randomUUID(),
    type,
    label:              defaultLabel[type],
    acceptanceCriteria: '',
    required:           type !== 'heading',
    placeholder:        '',
    optionsText:        '',
    unit:               type === 'measurement' ? 'mm' : '',
    minValue:           '',
    maxValue:           '',
    conditional:        null,
    sourcePage:         null,
    sourceText:         '',
    aiConfidence:       null,
    aiWarnings:         [],
    layout: {
      width:        type === 'heading' || type === 'table' ? 'full' : 'full',
      height:       type === 'table' ? 180 : 88,
      sectionLevel: 1,
      tableColumns: ['Item', 'Acceptance criteria', 'Result', 'Remarks'],
      tableRows:    4,
      rowBreakBefore: true,
    },
    // sortOrder is stored externally in the array index
  }
  void sortOrder  // used externally
}

function getDefaultLayout(type: FieldType): WIFieldLayout {
  return makeField(type, 0).layout
}

function parseLayout(value: unknown, type: FieldType): WIFieldLayout {
  const fallback = getDefaultLayout(type)
  if (!value || typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value) as Partial<WIFieldLayout>
    return {
      width:        parsed.width === 'half' || parsed.width === 'third' ? parsed.width : 'full',
      height:       typeof parsed.height === 'number' ? Math.max(56, Math.min(360, parsed.height)) : fallback.height,
      sectionLevel: parsed.sectionLevel === 2 || parsed.sectionLevel === 3 ? parsed.sectionLevel : 1,
      tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
        ? parsed.tableColumns.map(String).slice(0, 8)
        : fallback.tableColumns,
      tableRows:    typeof parsed.tableRows === 'number' ? Math.max(1, Math.min(20, parsed.tableRows)) : fallback.tableRows,
      rowBreakBefore: typeof parsed.rowBreakBefore === 'boolean' ? parsed.rowBreakBefore : true,
    }
  } catch {
    return fallback
  }
}

function fieldWidthUnits(field: WIField) {
  if (field.layout.width === 'full') return 3
  if (field.layout.width === 'half') return 1.5
  return 1
}

function fieldBasis(width: FieldWidth) {
  if (width === 'half') return 'calc(50% - 4px)'
  if (width === 'third') return 'calc(33.333% - 6px)'
  return '100%'
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMPTY_DATE_TEXT = /^(n\/a|na|nil|none|null|unknown|not stated|not stated in source|not mentioned|not available|not applicable)$/i

function normalizeDateValue(value: string) {
  const text = value.trim()
  if (!text || EMPTY_DATE_TEXT.test(text)) return ''
  if (ISO_DATE_RE.test(text)) return text
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function buildManualRows(fields: WIField[]) {
  const rows: WIField[][] = []
  let current: WIField[] = []
  let used = 0

  fields.forEach(field => {
    const units = fieldWidthUnits(field)
    const mustStartRow = current.length === 0 || field.layout.rowBreakBefore || used + units > 3
    if (mustStartRow) {
      if (current.length) rows.push(current)
      current = [field]
      used = units
    } else {
      current.push(field)
      used += units
    }
  })

  if (current.length) rows.push(current)
  return rows
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'routine-pm',
    name: 'Routine PM',
    desc: 'Safety, condition, measurement, sign-off',
    items: [
      { type: 'heading', label: 'Pre-check' },
      { type: 'pass_fail', label: 'Asset is isolated or safe to inspect', acceptanceCriteria: 'Inspection can proceed without exposing personnel to active hazards.' },
      { type: 'pass_fail', label: 'Asset tag and location match the work order', acceptanceCriteria: 'Asset identifier and physical location match the assigned work order.' },
      { type: 'heading', label: 'Inspection' },
      { type: 'yes_no', label: 'Any visible damage, leakage, corrosion, or loose parts?', acceptanceCriteria: 'No visible damage, leakage, corrosion, or looseness is present.' },
      { type: 'measurement', label: 'Record critical operating reading', acceptanceCriteria: 'Reading is within the approved operating range.', unit: 'mm', minValue: '', maxValue: '' },
      { type: 'photo', label: 'Attach photo evidence for abnormal findings', required: false },
      { type: 'textarea', label: 'Corrective action or follow-up required', required: false, placeholder: 'Enter action taken, parts required, or escalation notes' },
    ],
  },
  {
    id: 'safety-compliance',
    name: 'Safety Check',
    desc: 'Guards, labels, emergency stops, housekeeping',
    items: [
      { type: 'heading', label: 'Safety controls' },
      { type: 'pass_fail', label: 'Guards and covers are installed and secure', acceptanceCriteria: 'All guards are present, secured, and free from damage.' },
      { type: 'pass_fail', label: 'Emergency stop or isolation control is accessible', acceptanceCriteria: 'Control is visible, reachable, labelled, and unobstructed.' },
      { type: 'pass_fail', label: 'Warning labels and instruction plates are legible', acceptanceCriteria: 'Required labels are readable and fixed in place.' },
      { type: 'heading', label: 'Work area' },
      { type: 'yes_no', label: 'Any unsafe obstruction, spill, sharp edge, or trip hazard?', acceptanceCriteria: 'No unsafe site condition is present around the asset.' },
      { type: 'photo', label: 'Capture evidence for any unsafe condition', required: false },
    ],
  },
  {
    id: 'defect-triage',
    name: 'Defect Triage',
    desc: 'Failure observation, severity, action owner',
    items: [
      { type: 'heading', label: 'Failure details' },
      { type: 'dropdown', label: 'Observed defect type', optionsText: 'Mechanical damage\nElectrical fault\nLeakage\nCorrosion\nAbnormal noise\nOut of tolerance' },
      { type: 'textarea', label: 'Describe exact failure location and symptom', placeholder: 'Component, location, visible symptom, operating condition' },
      { type: 'photo', label: 'Attach close-up photo of defect' },
      { type: 'heading', label: 'Disposition' },
      { type: 'dropdown', label: 'Operational risk level', optionsText: 'Critical - stop work\nMajor - repair before release\nMinor - monitor and plan repair' },
      { type: 'textarea', label: 'Immediate containment or corrective action', acceptanceCriteria: 'Action is specific enough for supervisor review.' },
    ],
  },
]

function buildTemplateFields(template: StarterTemplate): WIField[] {
  return template.items.map((item, idx) => ({
    ...makeField(item.type, idx),
    ...item,
    id: crypto.randomUUID(),
    required: item.required ?? (item.type !== 'heading'),
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    placeholder: item.placeholder ?? '',
    optionsText: item.optionsText ?? '',
    unit: item.unit ?? (item.type === 'measurement' ? 'mm' : ''),
    minValue: item.minValue ?? '',
    maxValue: item.maxValue ?? '',
  }))
}

function getChecklistQuality(fields: WIField[]): QualityIssue[] {
  const issues: QualityIssue[] = []
  const checkable = fields.filter(f => f.type !== 'heading')

  if (checkable.length === 0) {
    issues.push({ level: 'error', message: 'Add at least one checkable inspection item before publishing.' })
  }

  fields.forEach((field, idx) => {
    const label = field.label.trim()
    if (!label) {
      issues.push({ level: 'error', message: `Item ${idx + 1} needs an inspection question or heading.` })
    }
    if (['dropdown', 'multiselect'].includes(field.type) && field.optionsText.split('\n').map(s => s.trim()).filter(Boolean).length < 2) {
      issues.push({ level: 'error', message: `${label || `Item ${idx + 1}`} needs at least two selectable options.` })
    }
    if (field.type === 'table' && field.layout.tableColumns.map(s => s.trim()).filter(Boolean).length < 2) {
      issues.push({ level: 'error', message: `${label || `Item ${idx + 1}`} needs at least two table columns.` })
    }
    if (['number', 'measurement'].includes(field.type) && field.minValue !== '' && field.maxValue !== '') {
      const min = Number(field.minValue)
      const max = Number(field.maxValue)
      if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        issues.push({ level: 'error', message: `${label || `Item ${idx + 1}`} has a minimum greater than maximum.` })
      }
    }
    if (!['heading', 'photo', 'signature', 'textarea', 'text'].includes(field.type) && !field.acceptanceCriteria.trim()) {
      issues.push({ level: 'warning', message: `${label || `Item ${idx + 1}`} should define clear pass criteria.` })
    }
  })

  return issues.slice(0, 8)
}

// ── Main component ───────────────────────────────────────────────
export default function WIBuilder() {
  const navigate      = useNavigate()
  const { id: editId } = useParams<{ id?: string }>()
  const { toast }     = useToast()
  const isEdit        = !!editId

  const [meta, setMeta] = useState<WIMeta>({
    wiNumber: '', title: 'New Work Instruction', category: '',
    revision: 'Rev 1', effectiveDate: '', expiryDate: '',
  })
  const [fields,     setFields]     = useState<WIField[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showPreview,setShowPreview]= useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [showImport,   setShowImport]   = useState(false)
  const [showExcelImport, setShowExcelImport] = useState(false)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [selectedApprovers, setSelectedApprovers] = useState<string[]>([])
  const [savedDraftId, setSavedDraftId] = useState('')

  // Drag state
  const dragTypeRef    = useRef<FieldType | null>(null)   // dragging from palette
  const dragFieldIdRef = useRef<string | null>(null)       // reordering canvas
  const [dragOverIdx,  setDragOverIdx] = useState<number | null>(null)
  const [dragPlacement, setDragPlacement] = useState<DragPlacement>('before')
  const [draggingUnits, setDraggingUnits] = useState(3)

  // Load existing WI when editing
  const { data: existingData, isLoading: loadingExisting } = useWIBuilderData(editId)
  const saveWI = useSaveWIWithItems()
  const submitForApproval = useSubmitForApproval()
  const { data: approvers = [] } = useApprovers()

  useEffect(() => {
    if (!existingData) return
    setMeta({
      wiNumber:      String(existingData.wi_number      ?? ''),
      title:         String(existingData.title          ?? ''),
      category:      String(existingData.category       ?? ''),
      revision:      String(existingData.revision       ?? 'Rev 1'),
      effectiveDate: normalizeDateValue(String(existingData.effective_date ?? '')),
      expiryDate:    normalizeDateValue(String(existingData.expiry_date    ?? '')),
    })
    const existingItems = existingData.wi_checklist_items as Record<string, unknown>[] | undefined
    if (existingItems?.length) {
      setFields(existingItems.map((item: Record<string, unknown>) => {
        const type = ((item.field_type as FieldType) ?? 'pass_fail')
        return ({
        id:                 item.id as string,
        type,
        label:              (item.description as string) ?? '',
        acceptanceCriteria: (item.acceptance_criteria as string) ?? '',
        required:           item.required !== false,
        placeholder:        (item.placeholder as string) ?? '',
        optionsText:        item.options_json ? (JSON.parse(item.options_json as string) as string[]).join('\n') : '',
        unit:               (item.unit as string) ?? '',
        minValue:           item.min_value != null ? String(item.min_value) : '',
        maxValue:           item.max_value != null ? String(item.max_value) : '',
        conditional:        item.conditional_json ? JSON.parse(item.conditional_json as string) as WIField['conditional'] : null,
        sourcePage:         item.source_page != null ? Number(item.source_page) : null,
        sourceText:         (item.source_text as string) ?? '',
        aiConfidence:       item.ai_confidence != null ? Number(item.ai_confidence) : null,
        aiWarnings:         Array.isArray(item.ai_warnings) ? item.ai_warnings as string[] : [],
        layout:             parseLayout(item.layout_json, type),
      })
      }))
    }
  }, [existingData])

  // ── Field operations ──────────────────────────────────────────
  const addField = useCallback((type: FieldType, atIndex?: number, layoutUpdates?: Partial<WIFieldLayout>) => {
    const f = makeField(type, 0)
    f.layout = { ...f.layout, ...layoutUpdates }
    setFields(prev => {
      const next = [...prev]
      const idx  = atIndex != null ? atIndex : next.length
      next.splice(idx, 0, f)
      return next
    })
    setSelectedId(f.id)
  }, [])

  const updateField = useCallback((id: string, updates: Partial<WIField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))
  }, [])

  const deleteField = useCallback((id: string) => {
    setFields(prev => prev.filter(f => f.id !== id))
    setSelectedId(s => s === id ? null : s)
  }, [])

  const duplicateField = useCallback((id: string) => {
    setFields(prev => {
      const idx = prev.findIndex(f => f.id === id)
      if (idx < 0) return prev
      const clone: WIField = { ...prev[idx], id: crypto.randomUUID() }
      const next = [...prev]
      next.splice(idx + 1, 0, clone)
      return next
    })
  }, [])

  const addTemplate = useCallback((template: StarterTemplate) => {
    const nextFields = buildTemplateFields(template)
    setFields(prev => [...prev, ...nextFields])
    setSelectedId(nextFields.find(f => f.type !== 'heading')?.id ?? nextFields[0]?.id ?? null)
    toast(`Added ${template.name} starter checklist`, 'success')
  }, [toast])

  // ── Drag handlers ─────────────────────────────────────────────
  const handleCanvasDragOver = (e: React.DragEvent, idx: number, canPlaceBeside = false) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / Math.max(rect.width, 1)
    const y = (e.clientY - rect.top) / Math.max(rect.height, 1)

    if (canPlaceBeside && x > 0.58 && y > 0.18 && y < 0.82) {
      setDragOverIdx(idx + 1)
      setDragPlacement('beside')
      return
    }

    if (y > 0.5) {
      setDragOverIdx(idx + 1)
      setDragPlacement('after')
    } else {
      setDragOverIdx(idx)
      setDragPlacement('before')
    }
  }

  const handleCanvasDrop = (e: React.DragEvent, dropIdx: number, placement: 'new-row' | 'same-row' = 'new-row') => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIdx(null)
    setDragPlacement('before')
    const rowBreakBefore = placement === 'new-row'

    const fromType = dragTypeRef.current
    if (fromType) {
      dragTypeRef.current = null
      addField(fromType, dropIdx, { rowBreakBefore })
      return
    }

    const fromId = dragFieldIdRef.current
    if (fromId) {
      dragFieldIdRef.current = null
      setFields(prev => {
        const fromIdx = prev.findIndex(f => f.id === fromId)
        if (fromIdx < 0) return prev
        if (fromIdx === dropIdx) {
          return prev.map((f, i) => i === fromIdx ? { ...f, layout: { ...f.layout, rowBreakBefore } } : f)
        }
        const next = [...prev]
        const [moved] = next.splice(fromIdx, 1)
        const insertAt = dropIdx > fromIdx ? dropIdx - 1 : dropIdx
        moved.layout = { ...moved.layout, rowBreakBefore }
        next.splice(insertAt, 0, moved)
        return next
      })
    }
  }

  // ── Save ──────────────────────────────────────────────────────
  const toggleApprover = (id: string) => {
    setSelectedApprovers(prev => prev.includes(id) ? prev.filter(approverId => approverId !== id) : [...prev, id])
  }

  const handleSave = async (submit: boolean) => {
    if (!meta.wiNumber.trim()) { toast('WI number is required', 'error'); return }
    if (!meta.title.trim())    { toast('Title is required', 'error'); return }
    const qualityIssues = getChecklistQuality(fields)
    const blockingIssue = qualityIssues.find(issue => issue.level === 'error')
    if (submit && blockingIssue) {
      toast(blockingIssue.message, 'error')
      return
    }
    if (submit && selectedApprovers.length === 0) {
      toast('Select at least one approver', 'error')
      return
    }

    const checklistItems = fields.map((f, i) => ({
      itemNo:              String(i + 1),
      description:         f.label,
      acceptanceCriteria:  f.acceptanceCriteria || undefined,
      fieldType:           f.type,
      required:            f.required,
      placeholder:         f.placeholder || undefined,
      optionsJson:         f.optionsText ? JSON.stringify(f.optionsText.split('\n').map(s => s.trim()).filter(Boolean)) : undefined,
      unit:                f.unit || undefined,
      minValue:            f.minValue !== '' ? Number(f.minValue) : undefined,
      maxValue:            f.maxValue !== '' ? Number(f.maxValue) : undefined,
      conditionalJson:     f.conditional ? JSON.stringify(f.conditional) : undefined,
      sourcePage:          f.sourcePage,
      sourceText:          f.sourceText || undefined,
      aiConfidence:        f.aiConfidence ?? undefined,
      aiWarnings:          f.aiWarnings.length > 0 ? f.aiWarnings : undefined,
      layoutJson:          JSON.stringify(f.layout),
      sortOrder:           i * 10,
    }))

    try {
      const saved = await saveWI.mutateAsync({
        dbId:          editId || savedDraftId || undefined,
        wiNumber:      meta.wiNumber,
        title:         meta.title,
        category:      meta.category,
        revision:      meta.revision,
        effectiveDate: meta.effectiveDate,
        expiryDate:    meta.expiryDate,
        status:        'draft',
        checklistItems,
      })
      const wiDbId = editId || savedDraftId || String((saved as { id?: string }).id ?? '')
      if (!editId && wiDbId) setSavedDraftId(wiDbId)
      if (submit) {
        if (!wiDbId) throw new Error('Saved WI, but could not identify it for approval submission')
        await submitForApproval.mutateAsync({ wiDbId, approverIds: selectedApprovers })
        toast('Saved and submitted for approval', 'success')
        setShowApprovalModal(false)
        setSelectedApprovers([])
        navigate('/approvals')
        return
      }
      toast('Saved as draft', 'success')
      navigate(wiDbId ? `/library/${wiDbId}` : '/library')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error')
    }
  }

  const selectedField = fields.find(f => f.id === selectedId) ?? null
  const requiredCount = fields.filter(f => f.required && f.type !== 'heading').length
  const qualityIssues = getChecklistQuality(fields)
  const manualRows = buildManualRows(fields)

  if (loadingExisting) {
    return (
      <div className="flex h-screen overflow-hidden bg-bg">
        <Sidebar />
        <div className="flex flex-col flex-1 items-center justify-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopNav breadcrumb={[
          { label: 'Master Library', path: '/library' },
          { label: isEdit ? 'Edit WI' : 'New WI' },
        ]} />

        {/* ── Builder top bar ───────────────────────────────────── */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-border bg-bg-2 flex-shrink-0">
          <button onClick={() => navigate('/library')}
            className="flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text transition-colors bg-transparent border-none cursor-pointer p-0 flex-shrink-0">
            <ArrowLeft size={14} /> Library
          </button>
          <div className="w-px h-4 bg-border flex-shrink-0" />

          {/* Editable title */}
          {editingTitle ? (
            <input
              autoFocus
              value={meta.title}
              onChange={e => setMeta(p => ({ ...p, title: e.target.value }))}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={e => e.key === 'Enter' && setEditingTitle(false)}
              className="flex-1 min-w-0 bg-transparent border-b border-accent text-[14px] font-semibold text-text outline-none py-0.5"
            />
          ) : (
            <button onClick={() => setEditingTitle(true)}
              className="flex-1 min-w-0 text-left text-[14px] font-semibold text-text hover:text-accent transition-colors bg-transparent border-none cursor-pointer truncate p-0">
              {meta.title}
            </button>
          )}

          {/* WI number */}
          <input
            value={meta.wiNumber}
            onChange={e => setMeta(p => ({ ...p, wiNumber: e.target.value }))}
            placeholder="WI-XX-000"
            className="w-28 px-2 py-1 bg-bg border border-border-2 rounded-[6px] text-[12px] font-mono text-accent outline-none focus:border-accent placeholder:text-text-3 flex-shrink-0"
          />

          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setShowImport(true)}>
              <Upload size={14} className="mr-1" /> Import PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowExcelImport(true)}>
              <FileSpreadsheet size={14} className="mr-1" /> Import Excel
            </Button>
            <div className="w-px h-4 bg-border" />
            <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)}>
              <Eye size={14} className="mr-1" /> Preview
            </Button>
            <Button variant="secondary" size="sm" loading={saveWI.isPending} onClick={() => handleSave(false)}>
              Save draft
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saveWI.isPending || submitForApproval.isPending}
              onClick={() => setShowApprovalModal(true)}
            >
              Submit for Approval
            </Button>
          </div>
        </div>

        {/* ── 3-panel layout ────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT — Palette */}
          <div className="w-[220px] flex-shrink-0 border-r border-border bg-bg-2 overflow-y-auto">
            <div className="px-3 pt-3 pb-3 border-b border-border">
              <p className="text-[9px] font-semibold text-text-3 uppercase tracking-[0.12em] mb-2">Starter checklists</p>
              <div className="flex flex-col gap-1.5">
                {STARTER_TEMPLATES.map(template => (
                  <button key={template.id}
                    onClick={() => addTemplate(template)}
                    className="w-full text-left rounded-[8px] border border-border bg-bg hover:border-accent hover:bg-accent-bg px-3 py-2 transition-colors">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-text">
                      <CheckSquare size={13} className="text-accent flex-shrink-0" />
                      {template.name}
                    </span>
                    <span className="block pl-5 text-[10px] text-text-3 leading-snug mt-0.5">{template.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3 pt-3 pb-1">
              <p className="text-[9px] font-semibold text-text-3 uppercase tracking-[0.12em]">Field types</p>
            </div>
            {PALETTE.map(({ type, label, desc, Icon }) => (
              <div key={type}
                draggable
                onDragStart={() => { dragTypeRef.current = type; setDraggingUnits(fieldWidthUnits({ layout: getDefaultLayout(type) } as WIField)) }}
                onDragEnd={() => { dragTypeRef.current = null; setDraggingUnits(3); setDragOverIdx(null) }}
                onClick={() => addField(type)}
                className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border cursor-grab hover:bg-bg-3 active:bg-bg-3 transition-colors select-none last:border-0">
                <Icon size={14} className="text-accent flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-text leading-tight truncate">{label}</p>
                  <p className="text-[10px] text-text-3 leading-tight truncate">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* CENTER — Canvas */}
          <div className="flex-1 flex flex-col overflow-hidden bg-bg">
            {/* Canvas header */}
            <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
              <span className="text-[12px] font-semibold text-text">Checklist canvas</span>
              <span className="text-[11px] text-text-3">
                {fields.length} field{fields.length !== 1 ? 's' : ''}
                {requiredCount > 0 && ` · ${requiredCount} required`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Meta row */}
              <div className="flex gap-3 px-5 py-3 border-b border-border bg-bg-2 flex-wrap">
                {[
                  { key: 'category',      label: 'Category',       placeholder: 'e.g. Electrical',  width: 'flex-1 min-w-[120px]' },
                  { key: 'revision',      label: 'Revision',       placeholder: 'Rev 1',             width: 'w-28' },
                  { key: 'effectiveDate', label: 'Effective',      placeholder: '',                  width: 'w-36', type: 'date' },
                  { key: 'expiryDate',    label: 'Expires',        placeholder: '',                  width: 'w-36', type: 'date' },
                ].map(f => (
                  <div key={f.key} className={f.width}>
                    <label className="block text-[9px] text-text-3 uppercase tracking-[0.09em] mb-0.5 font-semibold">{f.label}</label>
                    <input
                      type={(f as { type?: string }).type ?? 'text'}
                      value={meta[f.key as keyof WIMeta]}
                      onChange={e => setMeta(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full px-2 py-1 bg-bg border border-border rounded-[6px] text-[12px] text-text outline-none focus:border-accent placeholder:text-text-3"
                    />
                  </div>
                ))}
              </div>

              {/* Drop zone + field list */}
              <div
                className="min-h-[200px] p-4"
                onDragOver={e => { e.preventDefault(); if (dragOverIdx === null) setDragOverIdx(fields.length) }}
                onDrop={e => handleCanvasDrop(e, fields.length)}
                onDragLeave={() => setDragOverIdx(null)}>

                {fields.length === 0 && dragOverIdx === null && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-20 h-20 rounded-[16px] border-2 border-dashed border-border-2 flex items-center justify-center mb-4 text-text-3">
                      <Settings2 size={28} />
                    </div>
                    <p className="text-[13px] font-medium text-text-2">Drag fields here to build your checklist</p>
                    <p className="text-[12px] text-text-3 mt-1">or click any field type on the left</p>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                {manualRows.map((row, rowIdx) => {
                  const rowUsed = row.reduce((sum, field) => sum + fieldWidthUnits(field), 0)
                  return (
                  <div key={row.map(field => field.id).join('-') || rowIdx} className="flex items-stretch gap-2">
                  {row.map((field) => {
                    const idx = fields.findIndex(f => f.id === field.id)
                    const rowIncludesDragged = row.some(f => f.id === dragFieldIdRef.current)
                    const remainingUnits = 3 - (rowIncludesDragged ? rowUsed - draggingUnits : rowUsed)
                    const canPlaceBeside = field.layout.width !== 'full' && remainingUnits >= draggingUnits
                    return (
                  <div key={field.id} className="relative min-w-0" style={{ flexBasis: fieldBasis(field.layout.width), maxWidth: fieldBasis(field.layout.width) }}>
                    {/* Drop indicator above */}
                    {dragOverIdx === idx && dragPlacement !== 'beside' && (
                      <div className="absolute -top-1 left-0 right-0 h-0.5 bg-accent rounded-full transition-all z-10" />
                    )}
                    {dragOverIdx === idx + 1 && dragPlacement === 'after' && (
                      <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-accent rounded-full transition-all z-10" />
                    )}
                    {dragOverIdx === idx + 1 && dragPlacement === 'beside' && (
                      <div className="absolute top-1 bottom-1 -right-1 w-1 rounded-full bg-accent shadow-[0_0_0_3px_rgba(59,130,246,0.16)] z-10" />
                    )}

                    <CanvasFieldRow
                      field={field}
                      isSelected={selectedId === field.id}
                      onSelect={() => setSelectedId(field.id)}
                      onDuplicate={() => duplicateField(field.id)}
                      onDelete={() => deleteField(field.id)}
                      onDragStart={() => { dragFieldIdRef.current = field.id; setDraggingUnits(fieldWidthUnits(field)) }}
                      onDragEnd={() => { dragFieldIdRef.current = null; setDraggingUnits(3); setDragOverIdx(null); setDragPlacement('before') }}
                      onDragOver={e => handleCanvasDragOver(e, idx, canPlaceBeside)}
                      onDrop={e => handleCanvasDrop(e, dragOverIdx ?? idx, dragPlacement === 'beside' ? 'same-row' : 'new-row')}
                    />
                  </div>
                    )
                  })}
                  </div>
                  )
                })}
                </div>

                {/* Drop indicator at end */}
                {dragOverIdx === fields.length && fields.length > 0 && (
                  <div className="h-0.5 bg-accent rounded-full mx-2 mt-1 transition-all" />
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — Properties */}
          <div className="w-[280px] flex-shrink-0 border-l border-border bg-bg-2 overflow-y-auto">
            {selectedField
              ? <PropertiesPanel field={selectedField} allFields={fields} onChange={updateField} onDelete={deleteField} />
              : (
                <ChecklistQualityPanel fields={fields} issues={qualityIssues} onAddTemplate={addTemplate} />
              )
            }
          </div>
        </div>
        </div>

      <Modal
        open={showApprovalModal}
        onClose={() => { setShowApprovalModal(false); setSelectedApprovers([]) }}
        title="Submit Work Instruction for Approval"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowApprovalModal(false); setSelectedApprovers([]) }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saveWI.isPending || submitForApproval.isPending}
              disabled={selectedApprovers.length === 0}
              onClick={() => handleSave(true)}
            >
              Save and Submit
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-text-2 mb-4">
          This WI will be saved as a draft first, then routed to the selected approvers. It becomes active only after the final approval step is completed.
        </p>
        {approvers.length === 0 ? (
          <p className="text-[13px] text-text-3">No active admin or approver users are available.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {approvers.map(approver => (
              <label
                key={approver.id}
                className="flex items-center gap-3 rounded-[8px] border border-border-2 p-3 cursor-pointer transition-colors hover:bg-bg-3"
              >
                <input
                  type="checkbox"
                  checked={selectedApprovers.includes(approver.id)}
                  onChange={() => toggleApprover(approver.id)}
                  className="h-4 w-4 flex-shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-text">{approver.name}</span>
                  <span className="block truncate font-mono text-[11px] text-text-3">{approver.email}</span>
                </span>
                <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-3">
                  {approver.role}
                </span>
              </label>
            ))}
          </div>
        )}
        {selectedApprovers.length > 0 && (
          <p className="mt-3 text-[11px] text-text-3">
            {selectedApprovers.length} approver{selectedApprovers.length > 1 ? 's' : ''} selected. Approval steps will follow this selected order.
          </p>
        )}
      </Modal>

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal meta={meta} fields={fields} onClose={() => setShowPreview(false)} />
      )}

      {/* Import PDF modal */}
      {showImport && (
        <ImportPdfModal
          onClose={() => setShowImport(false)}
          onImport={(importedFields, importedMeta, importMode) => {
            setFields(prev => importMode === 'append' ? [...prev, ...importedFields] : importedFields)
            if (!isEdit || !meta.title || meta.title === 'New Work Instruction') {
              setMeta(p => ({
                ...p,
                title:    importedMeta.title    || p.title,
                wiNumber: importedMeta.wiNumber || p.wiNumber,
                revision: importedMeta.revision || p.revision,
              }))
            }
            setShowImport(false)
            toast(`Imported ${importedFields.length} items from PDF`, 'success')
          }}
        />
      )}

      {showExcelImport && (
        <ImportExcelModal
          onClose={() => setShowExcelImport(false)}
          onImport={(importedFields, importedMeta, importMode) => {
            setFields(prev => importMode === 'append' ? [...prev, ...importedFields] : importedFields)
            setMeta(p => ({
              ...p,
              title:         importedMeta.title         || p.title,
              wiNumber:      importedMeta.wiNumber      || p.wiNumber,
              revision:      importedMeta.revision      || p.revision,
              category:      importedMeta.category      || p.category,
              effectiveDate: normalizeDateValue(importedMeta.effectiveDate || '') || p.effectiveDate,
              expiryDate:    normalizeDateValue(importedMeta.expiryDate || '')    || p.expiryDate,
            }))
            setShowExcelImport(false)
            toast(`Imported ${importedFields.length} rows from Excel`, 'success')
          }}
        />
      )}
    </div>
  )
}

// ── Canvas field row ─────────────────────────────────────────────
function CanvasFieldRow({
  field, isSelected,
  onSelect, onDuplicate, onDelete,
  onDragStart, onDragEnd, onDragOver, onDrop,
}: {
  field: WIField; isSelected: boolean
  onSelect: () => void; onDuplicate: () => void; onDelete: () => void
  onDragStart: () => void; onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void
}) {
  const palette = PALETTE.find(p => p.type === field.type)
  const Icon = palette?.Icon ?? CheckSquare
  const extractionNeedsReview = (field.aiConfidence != null && field.aiConfidence < 0.75) || field.aiWarnings.length > 0
  const widthClass = 'w-full flex'

  if (field.type === 'heading') {
    return (
      <div
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragOver={onDragOver} onDrop={onDrop}
        onClick={onSelect}
        className={cn(
          widthClass,
          'items-center gap-2 px-3 mb-1 rounded-[8px] border cursor-pointer transition-all group',
          isSelected ? 'border-accent bg-accent/10 border-l-2' : 'border-transparent hover:border-border bg-bg-3'
        )}
        style={{ minHeight: Math.max(42, field.layout.height) }}>
        <GripVertical size={14} className="text-border-2 cursor-grab flex-shrink-0" />
        <AlignJustify size={13} className="text-text-2 flex-shrink-0" />
        <span className={cn(
          'flex-1 font-bold text-text uppercase tracking-[0.06em]',
          field.layout.sectionLevel === 1 ? 'text-[13px]' : field.layout.sectionLevel === 2 ? 'text-[12px]' : 'text-[11px]'
        )}>{field.label}</span>
        {extractionNeedsReview && (
          <span className="text-[9px] font-semibold text-warning bg-warning-bg/20 ring-1 ring-warning-border rounded px-1.5 py-0.5 uppercase">
            AI review
          </span>
        )}
        <span className="text-[9px] font-semibold text-text-3 bg-bg-2 rounded px-1.5 py-0.5 uppercase">heading</span>
        <div className="hidden group-hover:flex items-center gap-0.5">
          <button onClick={e => { e.stopPropagation(); onDuplicate() }}
            className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text hover:bg-border/30 bg-transparent border-none cursor-pointer">
            <Copy size={12} />
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-danger hover:bg-danger/10 bg-transparent border-none cursor-pointer">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    )
  }

  if (field.type === 'table') {
    return (
      <div
        draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragOver={onDragOver} onDrop={onDrop}
        onClick={onSelect}
        className={cn(
          widthClass,
          'flex-col gap-2 px-3 py-3 mb-1 rounded-[8px] border cursor-pointer transition-all group',
          isSelected ? 'border-accent border-l-[3px] bg-accent/5' : 'border-border hover:border-border-2 bg-bg hover:bg-bg-2'
        )}
        style={{ minHeight: Math.max(120, field.layout.height) }}>
        <div className="flex items-center gap-2">
          <GripVertical size={14} className="text-border-2 cursor-grab flex-shrink-0" />
          <Table2 size={14} className={cn('flex-shrink-0', isSelected ? 'text-accent' : 'text-text-3')} />
          <span className="flex-1 text-[13px] text-text truncate">{field.label}</span>
          <span className="text-[9px] font-semibold text-text-3 bg-bg-3 rounded px-1.5 py-0.5 uppercase flex-shrink-0">
            {field.layout.tableColumns.length} col x {field.layout.tableRows} row
          </span>
          <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
            <button onClick={e => { e.stopPropagation(); onDuplicate() }}
              className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text hover:bg-border/30 bg-transparent border-none cursor-pointer">
              <Copy size={12} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete() }}
              className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-danger hover:bg-danger/10 bg-transparent border-none cursor-pointer">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-[6px] border border-border bg-bg-2">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${field.layout.tableColumns.length}, minmax(80px, 1fr))` }}>
            {field.layout.tableColumns.map((col, i) => (
              <div key={i} className="border-r border-border last:border-r-0 bg-bg-3 px-2 py-1.5 text-[10px] font-semibold text-text-2 truncate">
                {col || `Column ${i + 1}`}
              </div>
            ))}
          </div>
          {Array.from({ length: Math.min(field.layout.tableRows, 4) }).map((_, row) => (
            <div key={row} className="grid border-t border-border" style={{ gridTemplateColumns: `repeat(${field.layout.tableColumns.length}, minmax(80px, 1fr))` }}>
              {field.layout.tableColumns.map((_, col) => (
                <div key={col} className="h-7 border-r border-border last:border-r-0 bg-bg px-2" />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop}
      onClick={onSelect}
      className={cn(
        widthClass,
        'items-center gap-2.5 px-3 py-3 mb-1 rounded-[8px] border cursor-pointer transition-all group',
        isSelected
          ? 'border-accent border-l-[3px] bg-accent/5'
          : 'border-border hover:border-border-2 bg-bg hover:bg-bg-2'
      )}
      style={{ minHeight: Math.max(48, field.layout.height) }}>
      <GripVertical size={14} className="text-border-2 cursor-grab flex-shrink-0" />
      <Icon size={14} className={cn('flex-shrink-0', isSelected ? 'text-accent' : 'text-text-3')} />
      <span className="flex-1 text-[13px] text-text truncate">{field.label}</span>
      <span className="text-[9px] font-semibold text-text-3 bg-bg-3 rounded px-1.5 py-0.5 uppercase flex-shrink-0">
        {TYPE_LABEL[field.type]}
      </span>
      {field.required && (
        <span className="w-1.5 h-1.5 rounded-full bg-danger flex-shrink-0" title="Required" />
      )}
      {field.conditional && (
        <span className="text-[9px] font-semibold text-violet-400 bg-violet-500/10 ring-1 ring-violet-500/20 rounded px-1.5 py-0.5 flex-shrink-0">
          cond
        </span>
      )}
      {extractionNeedsReview && (
        <span className="text-[9px] font-semibold text-warning bg-warning-bg/20 ring-1 ring-warning-border rounded px-1.5 py-0.5 flex-shrink-0 uppercase">
          AI review
        </span>
      )}
      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
        <button onClick={e => { e.stopPropagation(); onDuplicate() }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-text hover:bg-border/30 bg-transparent border-none cursor-pointer">
          <Copy size={12} />
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete() }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-3 hover:text-danger hover:bg-danger/10 bg-transparent border-none cursor-pointer">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ── Properties panel ─────────────────────────────────────────────
function ChecklistQualityPanel({
  fields, issues, onAddTemplate,
}: {
  fields: WIField[]
  issues: QualityIssue[]
  onAddTemplate: (template: StarterTemplate) => void
}) {
  const checkableCount = fields.filter(f => f.type !== 'heading').length
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')
  const ready = fields.length > 0 && errors.length === 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-semibold text-text">Checklist quality</p>
        <p className="text-[10px] text-text-3 mt-0.5">{checkableCount} checkable item{checkableCount === 1 ? '' : 's'}</p>
      </div>

      <div className="px-4 py-3 border-b border-border">
        <div className={cn(
          'flex items-start gap-2 rounded-[8px] border px-3 py-2',
          ready
            ? 'border-success-border bg-success-bg/20 text-success'
            : errors.length > 0
            ? 'border-warning-border bg-warning-bg/20 text-warning'
            : 'border-border bg-bg text-text-2'
        )}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <p className="text-[12px] leading-relaxed">
            {ready
              ? 'Ready to publish.'
              : fields.length === 0
              ? 'Start with a template or add checklist items.'
              : `${errors.length} blocker${errors.length === 1 ? '' : 's'} before publish.`}
          </p>
        </div>
      </div>

      {fields.length === 0 && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] font-semibold text-text-3 uppercase tracking-[0.09em] mb-2">Quick start</p>
          <div className="flex flex-col gap-1.5">
            {STARTER_TEMPLATES.map(template => (
              <button key={template.id}
                onClick={() => onAddTemplate(template)}
                className="w-full text-left rounded-[8px] border border-border bg-bg hover:border-accent hover:bg-accent-bg px-3 py-2 transition-colors">
                <span className="flex items-center gap-2 text-[12px] font-medium text-text">
                  <CheckSquare size={13} className="text-accent flex-shrink-0" />
                  {template.name}
                </span>
                <span className="block pl-5 text-[10px] text-text-3 leading-snug mt-0.5">{template.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        {issues.length === 0 ? (
          <p className="text-[12px] text-text-3">Select any field to tune labels, pass criteria, options, and required state.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {[...errors, ...warnings].map((issue, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={cn(
                  'mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0',
                  issue.level === 'error' ? 'bg-danger' : 'bg-warning'
                )} />
                <p className={cn(
                  'text-[11px] leading-relaxed',
                  issue.level === 'error' ? 'text-danger' : 'text-text-2'
                )}>
                  {issue.message}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PropertiesPanel({
  field, allFields, onChange, onDelete,
}: {
  field: WIField; allFields: WIField[]
  onChange: (id: string, updates: Partial<WIField>) => void
  onDelete: (id: string) => void
}) {
  const upd = (updates: Partial<WIField>) => onChange(field.id, updates)
  const otherFields = allFields.filter(f => f.id !== field.id && f.type !== 'heading')

  const SECTION = 'px-4 py-3 border-b border-border'
  const LABEL   = 'block text-[10px] font-semibold text-text-3 uppercase tracking-[0.09em] mb-1'
  const INPUT   = 'w-full px-2.5 py-1.5 bg-bg border border-border rounded-[6px] text-[12px] text-text outline-none focus:border-accent placeholder:text-text-3 transition-colors'

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] font-semibold text-text">
          {PALETTE.find(p => p.type === field.type)?.label ?? field.type}
        </p>
        <p className="text-[10px] text-text-3 mt-0.5">Field configuration</p>
      </div>

      {(field.sourcePage || field.sourceText || field.aiConfidence != null || field.aiWarnings.length > 0) && (
        <div className={SECTION}>
          <label className={LABEL}>AI extraction evidence</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {field.sourcePage && (
              <span className="text-[10px] text-text-2 bg-bg border border-border rounded px-1.5 py-0.5">
                Page {field.sourcePage}
              </span>
            )}
            {field.aiConfidence != null && (
              <span className={cn(
                'text-[10px] border rounded px-1.5 py-0.5',
                field.aiConfidence < 0.75
                  ? 'text-warning bg-warning-bg/20 border-warning-border'
                  : 'text-success bg-success-bg/20 border-success-border'
              )}>
                {Math.round(field.aiConfidence * 100)}% confidence
              </span>
            )}
          </div>
          {field.sourceText && (
            <p className="text-[11px] text-text-2 leading-relaxed bg-bg border border-border rounded-[6px] p-2">
              {field.sourceText}
            </p>
          )}
          {field.aiWarnings.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {field.aiWarnings.map((warning, i) => (
                <p key={i} className="text-[11px] text-warning leading-relaxed">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Label */}
      <div className={SECTION}>
        <label className={LABEL}>Inspection question</label>
        <input
          autoFocus
          value={field.label}
          onChange={e => upd({ label: e.target.value })}
          className={INPUT}
          placeholder="Field label…"
        />
        <p className="text-[10px] text-text-3 mt-1">Shown as the checklist step during inspection</p>
      </div>

      {/* Acceptance criteria (not for heading, photo, signature) */}
      {!['heading', 'photo', 'signature'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Acceptance criteria</label>
          <textarea
            value={field.acceptanceCriteria}
            onChange={e => upd({ acceptanceCriteria: e.target.value })}
            rows={2}
            placeholder="What constitutes a pass? e.g. Gap &lt; 6mm"
            className={INPUT + ' resize-none'}
          />
        </div>
      )}

      {/* Required toggle */}
      {field.type !== 'heading' && (
        <div className={SECTION}>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <div
              onClick={() => upd({ required: !field.required })}
              className={cn(
                'w-8 h-4 rounded-full transition-colors cursor-pointer flex-shrink-0 relative',
                field.required ? 'bg-accent' : 'bg-border-2'
              )}>
              <div className={cn(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform',
                field.required ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </div>
            <span className="text-[12px] text-text">Required</span>
          </label>
          <p className="text-[10px] text-text-3 mt-1">Inspector cannot skip this field</p>
        </div>
      )}

      <div className={SECTION}>
        <label className={LABEL}>Layout</label>
        <p className="text-[10px] text-text-3 mb-2">Items stay on separate rows unless you drag another item onto a side drop target. Third allows up to 3 per row.</p>
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {(['full', 'half', 'third'] as const).map(width => (
            <button
              key={width}
              onClick={() => upd({ layout: { ...field.layout, width } })}
              className={cn(
                'h-8 rounded-[6px] border text-[11px] capitalize bg-transparent cursor-pointer transition-colors',
                field.layout.width === width
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-2 hover:border-border-2'
              )}
            >
              {width}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-text-3 mb-0.5">Height</p>
            <input
              type="number"
              min={field.type === 'table' ? 120 : 48}
              max={360}
              value={field.layout.height}
              onChange={e => upd({ layout: { ...field.layout, height: Math.max(48, Number(e.target.value) || 48) } })}
              className={INPUT}
            />
          </div>
          {field.type === 'heading' && (
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Section level</p>
              <select
                value={field.layout.sectionLevel}
                onChange={e => upd({ layout: { ...field.layout, sectionLevel: Number(e.target.value) as 1 | 2 | 3 } })}
                className={INPUT}
              >
                <option value={1}>Primary</option>
                <option value={2}>Subsection</option>
                <option value={3}>Minor</option>
              </select>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={field.layout.rowBreakBefore}
            onChange={e => upd({ layout: { ...field.layout, rowBreakBefore: e.target.checked } })}
            className="accent-accent w-3.5 h-3.5"
          />
          <span className="text-[11px] text-text-2">Start on new row</span>
        </label>
      </div>

      {field.type === 'table' && (
        <div className={SECTION}>
          <label className={LABEL}>Table structure</label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Rows</p>
              <input
                type="number"
                min={1}
                max={20}
                value={field.layout.tableRows}
                onChange={e => upd({ layout: { ...field.layout, tableRows: Math.max(1, Math.min(20, Number(e.target.value) || 1)) } })}
                className={INPUT}
              />
            </div>
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Columns</p>
              <input
                type="number"
                min={2}
                max={8}
                value={field.layout.tableColumns.length}
                onChange={e => {
                  const count = Math.max(2, Math.min(8, Number(e.target.value) || 2))
                  const next = Array.from({ length: count }, (_, i) => field.layout.tableColumns[i] ?? `Column ${i + 1}`)
                  upd({ layout: { ...field.layout, tableColumns: next } })
                }}
                className={INPUT}
              />
            </div>
          </div>
          <textarea
            value={field.layout.tableColumns.join('\n')}
            onChange={e => {
              const columns = e.target.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8)
              upd({ layout: { ...field.layout, tableColumns: columns.length ? columns : ['Column 1', 'Column 2'] } })
            }}
            rows={5}
            placeholder={"Item\nAcceptance criteria\nResult\nRemarks"}
            className={INPUT + ' resize-none font-mono text-[11px]'}
          />
        </div>
      )}

      {/* Type-specific settings */}
      {['text', 'textarea'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Placeholder text</label>
          <input value={field.placeholder} onChange={e => upd({ placeholder: e.target.value })}
            className={INPUT} placeholder="Hint shown inside the field…" />
        </div>
      )}

      {field.type === 'number' && (
        <div className={SECTION}>
          <label className={LABEL}>Range</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Min</p>
              <input type="number" value={field.minValue} onChange={e => upd({ minValue: e.target.value })}
                className={INPUT} placeholder="0" />
            </div>
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Max</p>
              <input type="number" value={field.maxValue} onChange={e => upd({ maxValue: e.target.value })}
                className={INPUT} placeholder="100" />
            </div>
          </div>
        </div>
      )}

      {field.type === 'measurement' && (
        <div className={SECTION}>
          <label className={LABEL}>Unit</label>
          <select value={field.unit} onChange={e => upd({ unit: e.target.value })}
            className={INPUT}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Min value</p>
              <input type="number" value={field.minValue} onChange={e => upd({ minValue: e.target.value })}
                className={INPUT} placeholder="0" />
            </div>
            <div>
              <p className="text-[10px] text-text-3 mb-0.5">Max value</p>
              <input type="number" value={field.maxValue} onChange={e => upd({ maxValue: e.target.value })}
                className={INPUT} placeholder="100" />
            </div>
          </div>
        </div>
      )}

      {['dropdown', 'multiselect'].includes(field.type) && (
        <div className={SECTION}>
          <label className={LABEL}>Options (one per line)</label>
          <textarea
            value={field.optionsText}
            onChange={e => upd({ optionsText: e.target.value })}
            rows={4}
            placeholder={"Option A\nOption B\nOption C"}
            className={INPUT + ' resize-none font-mono text-[11px]'}
          />
        </div>
      )}

      {/* Conditional logic */}
      {field.type !== 'heading' && otherFields.length > 0 && (
        <div className={SECTION}>
          <label className={LABEL}>
            <Zap size={10} className="inline mr-1 text-violet-400" />
            Conditional logic
          </label>
          <select
            value={field.conditional?.fieldId ?? ''}
            onChange={e => {
              const fieldId = e.target.value
              upd({ conditional: fieldId ? { fieldId, operator: 'equals', value: '' } : null })
            }}
            className={INPUT}>
            <option value="">Always visible</option>
            {otherFields.map(f => (
              <option key={f.id} value={f.id}>{f.label.slice(0, 40)}</option>
            ))}
          </select>
          {field.conditional && (
            <div className="mt-2 flex gap-1.5">
              <select
                value={field.conditional.operator}
                onChange={e => upd({ conditional: { ...field.conditional!, operator: e.target.value as 'equals' | 'not_equals' | 'contains' } })}
                className={INPUT + ' flex-1'}>
                <option value="equals">equals</option>
                <option value="not_equals">does not equal</option>
                <option value="contains">contains</option>
              </select>
              <input
                value={field.conditional.value}
                onChange={e => upd({ conditional: { ...field.conditional!, value: e.target.value } })}
                className={INPUT + ' flex-1'} placeholder="value" />
            </div>
          )}
        </div>
      )}

      {/* Delete */}
      {field.type !== 'heading' && (
        <div className="px-4 py-3">
          <button
            onClick={() => onDelete(field.id)}
            className="w-full px-3 py-1.5 text-[12px] text-danger border border-danger/30 rounded-[6px] hover:bg-danger/10 bg-transparent cursor-pointer transition-colors">
            Delete field
          </button>
        </div>
      )}
    </div>
  )
}

// ── Preview modal ─────────────────────────────────────────────────
function PreviewModal({ meta, fields, onClose }: { meta: WIMeta; fields: WIField[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-bg border border-border rounded-[16px] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <p className="text-[14px] font-semibold text-text">Inspector preview</p>
            <p className="text-[11px] text-text-3 mt-0.5">Exactly what the inspector sees</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[6px] text-text-3 hover:text-text hover:bg-bg-2 bg-transparent border-none cursor-pointer transition-all">
            <X size={16} />
          </button>
        </div>

        {/* WO info mock */}
        <div className="px-6 pt-4 pb-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-accent bg-accent/10 px-2 py-0.5 rounded">{meta.wiNumber || 'WI-XXX'}</span>
            <span className="text-[13px] font-semibold text-text">{meta.title}</span>
            <span className="text-[11px] text-text-3">{meta.revision}</span>
          </div>
        </div>

        {/* Fields preview */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {fields.length === 0 && (
            <p className="text-[13px] text-text-3 text-center py-8">No fields added yet</p>
          )}

          {fields.map((field, idx) => (
            <PreviewField key={field.id} field={field} index={idx} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewField({ field, index }: { field: WIField; index: number }) {
  if (field.type === 'heading') {
    return (
      <div className="flex items-center gap-3 mt-2">
        <div className="flex-1 h-px bg-border" />
        <span className={cn(
          'font-bold text-text uppercase tracking-[0.08em] whitespace-nowrap',
          field.layout.sectionLevel === 1 ? 'text-[12px]' : field.layout.sectionLevel === 2 ? 'text-[11px]' : 'text-[10px]'
        )}>{field.label}</span>
        <div className="flex-1 h-px bg-border" />
      </div>
    )
  }

  const INPUT_CLS = 'w-full px-3 py-2 bg-bg-2 border border-border rounded-[8px] text-[13px] text-text outline-none placeholder:text-text-3'

  return (
    <div className="bg-bg-2 border border-border rounded-[10px] p-4">
      <div className="flex items-start gap-2 mb-3">
        <span className="font-mono text-[10px] text-text-3 pt-0.5 w-5 flex-shrink-0">{index + 1}</span>
        <div className="flex-1">
          <p className="text-[13px] font-medium text-text">{field.label}</p>
          {field.acceptanceCriteria && (
            <p className="text-[11px] text-text-3 italic mt-0.5">{field.acceptanceCriteria}</p>
          )}
          {field.conditional && (
            <span className="inline-block mt-1 text-[9px] font-semibold text-violet-400 bg-violet-500/10 ring-1 ring-violet-500/20 rounded px-1.5 py-0.5">
              conditional
            </span>
          )}
          {(field.aiConfidence != null || field.aiWarnings.length > 0) && (
            <span className={cn(
              'inline-block mt-1 ml-1 text-[9px] font-semibold rounded px-1.5 py-0.5 ring-1',
              (field.aiConfidence != null && field.aiConfidence < 0.75) || field.aiWarnings.length > 0
                ? 'text-warning bg-warning-bg/20 ring-warning-border'
                : 'text-success bg-success-bg/20 ring-success-border'
            )}>
              AI imported {field.aiConfidence != null ? `${Math.round(field.aiConfidence * 100)}%` : ''}
            </span>
          )}
        </div>
        {field.required && <AlertCircle size={12} className="text-danger flex-shrink-0 mt-0.5" />}
      </div>

      {field.type === 'pass_fail' && (
        <div className="flex gap-2">
          {[
            { label: 'PASS', cls: 'border-success/40 text-success hover:bg-success/10' },
            { label: 'FAIL', cls: 'border-danger/40 text-danger hover:bg-danger/10' },
            { label: 'N/A',  cls: 'border-border-2 text-text-3 hover:bg-bg-3' },
          ].map(b => (
            <button key={b.label}
              className={`flex-1 h-11 rounded-[8px] border text-[12px] font-semibold bg-transparent cursor-pointer transition-colors ${b.cls}`}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {field.type === 'table' && (
        <div className="overflow-auto rounded-[8px] border border-border">
          <div className="grid min-w-[520px]" style={{ gridTemplateColumns: `repeat(${field.layout.tableColumns.length}, minmax(120px, 1fr))` }}>
            {field.layout.tableColumns.map((col, i) => (
              <div key={i} className="border-r border-border last:border-r-0 bg-bg-3 px-3 py-2 text-[11px] font-semibold text-text-2">
                {col}
              </div>
            ))}
          </div>
          {Array.from({ length: field.layout.tableRows }).map((_, row) => (
            <div key={row} className="grid min-w-[520px] border-t border-border" style={{ gridTemplateColumns: `repeat(${field.layout.tableColumns.length}, minmax(120px, 1fr))` }}>
              {field.layout.tableColumns.map((_, col) => (
                <input
                  key={col}
                  className="h-10 min-w-0 border-0 border-r border-border last:border-r-0 bg-bg-2 px-3 text-[12px] text-text outline-none focus:bg-bg"
                  placeholder={row === 0 ? 'Enter value' : ''}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {field.type === 'yes_no' && (
        <div className="flex gap-2">
          {[{ label: 'Yes', cls: 'border-success/40 text-success hover:bg-success/10' },
            { label: 'No',  cls: 'border-danger/40 text-danger hover:bg-danger/10' }].map(b => (
            <button key={b.label}
              className={`flex-1 h-11 rounded-[8px] border text-[12px] font-semibold bg-transparent cursor-pointer transition-colors ${b.cls}`}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {field.type === 'text' && (
        <input className={INPUT_CLS} placeholder={field.placeholder || 'Enter text…'} readOnly />
      )}

      {field.type === 'textarea' && (
        <textarea className={INPUT_CLS + ' resize-none'} rows={3}
          placeholder={field.placeholder || 'Enter notes…'} readOnly />
      )}

      {field.type === 'number' && (
        <div className="flex items-center gap-2">
          <input type="number" className={INPUT_CLS} placeholder="0" readOnly />
          {(field.minValue || field.maxValue) && (
            <span className="text-[11px] text-text-3 whitespace-nowrap">
              {field.minValue && `min ${field.minValue}`}
              {field.minValue && field.maxValue && ' – '}
              {field.maxValue && `max ${field.maxValue}`}
            </span>
          )}
        </div>
      )}

      {field.type === 'measurement' && (
        <div className="flex items-center gap-2">
          <input type="number" className={INPUT_CLS} placeholder="0.0" readOnly />
          <span className="px-3 py-2 bg-bg-3 border border-border rounded-[8px] text-[12px] font-mono text-text-2 whitespace-nowrap">
            {field.unit || 'unit'}
          </span>
        </div>
      )}

      {field.type === 'dropdown' && (
        <select className={INPUT_CLS}>
          <option value="">Select…</option>
          {field.optionsText.split('\n').filter(Boolean).map((opt, i) => (
            <option key={i} value={opt}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'multiselect' && (
        <div className="flex flex-col gap-2">
          {field.optionsText.split('\n').filter(Boolean).map((opt, i) => (
            <label key={i} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" readOnly />
              <span className="text-[12px] text-text">{opt}</span>
            </label>
          ))}
          {!field.optionsText && <p className="text-[12px] text-text-3 italic">No options defined</p>}
        </div>
      )}

      {field.type === 'date' && (
        <input type="date" className={INPUT_CLS} readOnly />
      )}

      {field.type === 'photo' && (
        <div className="flex flex-col items-center justify-center py-6 rounded-[8px] border-2 border-dashed border-border-2 text-text-3 gap-2">
          <Camera size={24} />
          <p className="text-[12px]">Tap to capture photo</p>
        </div>
      )}

      {field.type === 'signature' && (
        <div className="flex flex-col items-center justify-center py-8 rounded-[8px] border-2 border-dashed border-border-2 text-text-3 gap-2">
          <PenLine size={24} />
          <p className="text-[12px]">Sign here</p>
        </div>
      )}
    </div>
  )
}
